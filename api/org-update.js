// /api/org-update.js
// Secure org update (owner/admin only)
// Updates: brand_name, brand colors, logo, domain, name

import { createClient } from "@supabase/supabase-js"

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
}

function send(res, status, data){
  res.statusCode = status
  Object.entries(cors).forEach(([k,v]) => res.setHeader(k,v))
  res.setHeader("Content-Type","application/json")
  res.end(JSON.stringify(data))
}

export default async function handler(req,res){

try{

if(req.method === "OPTIONS") return send(res,200,{ok:true})
if(req.method !== "POST") return send(res,405,{error:"Method not allowed"})

const supabaseAdmin = createClient(
process.env.SUPABASE_URL,
process.env.SUPABASE_SERVICE_ROLE_KEY,
{ auth:{ persistSession:false } }
)

const authHeader = req.headers.authorization || req.headers.Authorization
if(!authHeader?.startsWith("Bearer ")) return send(res,401,{error:"Missing token"})

const token = authHeader.slice(7).trim()

const { data:userData, error:userErr } =
await supabaseAdmin.auth.getUser(token)

if(userErr || !userData?.user)
return send(res,401,{error:"Invalid token"})

const body = await new Promise(resolve=>{
let raw=""
req.on("data",c=>raw+=c)
req.on("end",()=>resolve(raw?JSON.parse(raw):{}))
})

const org_id = body.org_id
if(!org_id) return send(res,400,{error:"org_id required"})

// Check org role
const { data:member } = await supabaseAdmin
.from("org_members")
.select("role")
.eq("org_id",org_id)
.eq("user_id",userData.user.id)
.maybeSingle()

if(!member || !["owner","admin"].includes(member.role))
return send(res,403,{error:"Owner/Admin only"})

// Build safe update object
const patch = {}

if(body.name) patch.name = String(body.name).slice(0,80)
if(body.brand_name) patch.brand_name = String(body.brand_name).slice(0,80)
if(body.brand_primary) patch.brand_primary = body.brand_primary
if(body.brand_secondary) patch.brand_secondary = body.brand_secondary
if(body.logo_url) patch.logo_url = body.logo_url
if(body.whitelabel_domain) patch.whitelabel_domain = body.whitelabel_domain

if(Object.keys(patch).length === 0)
return send(res,400,{error:"Nothing to update"})

const { data:updated, error:updateErr } =
await supabaseAdmin
.from("orgs")
.update(patch)
.eq("id",org_id)
.select()
.single()

if(updateErr) return send(res,500,{error:updateErr.message})

return send(res,200,{ok:true,org:updated})

}catch(e){
return send(res,500,{error:e.message})
}

}
