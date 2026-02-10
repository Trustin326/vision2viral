import { createClient } from "@supabase/supabase-js"

export default async function handler(req,res){

const supabase = createClient(
process.env.SUPABASE_URL,
process.env.SUPABASE_SERVICE_ROLE_KEY
)

const token = req.headers.authorization?.replace("Bearer ","")

const { data:userData } = await supabase.auth.getUser(token)
if(!userData?.user) return res.status(401).json({error:"Unauthorized"})

const { upload_id } = req.body

return res.json({
output:{
hooks:["Stop scrolling — this works"],
caption:"AI content generated",
hashtags:["#viral","#ai"],
video_script:{hook:"Hook text",scene_by_scene:["Scene 1","Scene 2"],voiceover:"VO",cta:"Follow"},
video_ideas:["Idea 1","Idea 2"]
}
})

}

