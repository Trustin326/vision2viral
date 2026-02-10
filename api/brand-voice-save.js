// /api/brand-voice-save.js
// Secure brand voice save per org

import { createClient } from "@supabase/supabase-js"

const cors = {
"Access-Control-Allow-Origin":"*",
"Access-Control-Allow-Methods":"POST, OPTIONS",
"Access-Control-Allow-Headers":"Content-Type, Authorization"
}

function send(res,status,data){
res.statusCode=status
Object.entries(cors).forEach(([k,v])=>res.setHeader(k,v))
res.setHeader("Content-Type","application/json")
res.end(JSON.stringify(data))
}

export default async function handler(req,res){

try{

if(req.method==="OPTIONS") return send(res,200,{ok:true})
if(req.method!=="POST") return send(res,405,{error:"Method not allowed"})

const supabaseAdmin=createClient(
process.env.SUPABASE_URL,
process.env.SUPABASE_SERVICE_ROLE_KEY,
{auth:{persistSession:false}}
)

const authHeader=req.headers.authorization||req.headers.Authorization
if(!authHeader?.startsWith("Bearer "))
return send(res,401,{error:"Missing token"})

const token=authHeader.slice(7).trim()

const {data:userData,error:userErr} =
await supabaseAdmin.auth.getUser(token)

if(userErr||!userData?.user)
return send(res,401,{error:"Invalid token"})

const body=await new Promise(resolve=>{
let raw=""
req.on("data",c=>raw+=c)
req.on("end",()=>resolve(raw?JSON.parse(raw):{}))
})

const org_id=body.org_id
const instructions=String(body.instructions||"")

if(!org_id||!instructions)
return send(res,400,{error:"org_id + instructions required"})

// Check role
const {data:member}=await supabaseAdmin
.from("org_members")
.select("role")
.eq("org_id",org_id)
.eq("user_id",userData.user.id)
.maybeSingle()

if(!member||!["owner","admin"].includes(member.role))
return send(res,403,{error:"Owner/Admin only"})

const {data:voice,error:voiceErr} =
await supabaseAdmin
.from("brand_voices")
.insert({
org_id,
name:"Default",
instructions:instructions.slice(0,10000)
})
.select()
.single()

if(voiceErr) return send(res,500,{error:voiceErr.message})

return send(res,200,{ok:true,voice})

}catch(e){
return send(res,500,{error:e.message})
}

}
