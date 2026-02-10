import { createClient } from "@supabase/supabase-js"

export default async function handler(req,res){

try{

if(req.method !== "POST"){
return res.status(405).json({error:"Method not allowed"})
}

const supabase = createClient(
process.env.SUPABASE_URL,
process.env.SUPABASE_SERVICE_ROLE_KEY
)

const token = req.headers.authorization?.replace("Bearer ","")

if(!token) return res.status(401).json({error:"No token"})

const { data:userData } = await supabase.auth.getUser(token)

if(!userData?.user){
return res.status(401).json({error:"Unauthorized"})
}

const { niche="general", platform="tiktok" } = req.body

/* Simple starter calendar generator */

const days = 30
const calendar = []

for(let i=1;i<=days;i++){

calendar.push({
day:i,
platform,
hook:`Day ${i}: ${niche} growth tip`,
caption:`Post ${i} for ${niche} audience`,
cta:"Follow for more",
idea:`Content idea ${i} for ${niche}`
})

}

return res.json({calendar})

}catch(e){
return res.status(500).json({error:e.message})
}

}

