import { createClient } from "@supabase/supabase-js";
const cors = { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Methods":"POST, OPTIONS", "Access-Control-Allow-Headers":"Content-Type, Authorization" };
const resp=(s,d)=>new Response(JSON.stringify(d),{status:s,headers:{...cors,"Content-Type":"application/json"}});

export default async function handler(req){
  try{
    if(req.method==="OPTIONS") return resp(200,{ok:true});
    if(req.method!=="POST") return resp(405,{error:"Method not allowed"});

    const supabaseAdmin=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
    const authHeader=req.headers.authorization||req.headers.Authorization;
    if(!authHeader?.startsWith("Bearer ")) return resp(401,{error:"Missing token"});
    const token=authHeader.slice(7).trim();

    const { data: userData } = await supabaseAdmin.auth.getUser(token);
    if(!userData?.user) return resp(401,{error:"Invalid token"});

    const body=await req.json().catch(()=>({}));
    const org_id=body.org_id;
    const email=String(body.email||"").toLowerCase().trim();
    const role=String(body.role||"member").toLowerCase();

    if(!org_id || !email) return resp(400,{error:"org_id and email required"});

    // ensure caller is org owner/admin
    const { data: member } = await supabaseAdmin
      .from("org_members")
      .select("role")
      .eq("org_id", org_id)
      .eq("user_id", userData.user.id)
      .maybeSingle();

    if(!member || !["owner","admin"].includes((member.role||"").toLowerCase()))
      return resp(403,{error:"Org admin only"});

    const { data: invite, error } = await supabaseAdmin
      .from("org_invites")
      .insert({ org_id, email, role, status:"pending" })
      .select()
      .single();

    if(error) return resp(500,{error:error.message});
    return resp(200,{ok:true, invite});
  }catch(e){
    return resp(500,{error:e?.message||"Server error"});
  }
}
