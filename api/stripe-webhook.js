import Stripe from "stripe"
import { createClient } from "@supabase/supabase-js"

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

const supabase = createClient(
process.env.SUPABASE_URL,
process.env.SUPABASE_SERVICE_ROLE_KEY
)

const planCredits = {
starter: 200,
creator: 1000,
agency: 999999
}

export const config = {
api: {
bodyParser: false
}
}

export default async function handler(req,res){

const sig = req.headers["stripe-signature"]

let event

try{
const rawBody = await buffer(req)
event = stripe.webhooks.constructEvent(
rawBody,
sig,
process.env.STRIPE_WEBHOOK_SECRET
)
}catch(err){
return res.status(400).send(`Webhook Error: ${err.message}`)
}

try{

switch(event.type){

case "checkout.session.completed":{
const session = event.data.object

const email = session.customer_email
const plan = session.metadata.plan || "starter"

const {data:userProfile} = await supabase
.from("profiles")
.select("*")
.eq("email",email)
.single()

if(userProfile){

await supabase.from("profiles").update({
plan,
credits_remaining: planCredits[plan]
}).eq("id",userProfile.id)

await supabase.from("subscriptions").insert({
user_id:userProfile.id,
stripe_customer_id:session.customer,
stripe_subscription_id:session.subscription,
plan,
status:"active"
})

}

break
}

case "invoice.payment_succeeded":{
const invoice = event.data.object

const subscriptionId = invoice.subscription

const {data:sub} = await supabase
.from("subscriptions")
.select("*")
.eq("stripe_subscription_id",subscriptionId)
.single()

if(sub){

await supabase.from("profiles").update({
credits_remaining: planCredits[sub.plan]
}).eq("id",sub.user_id)

}

break
}

case "customer.subscription.deleted":{
const subscription = event.data.object

await supabase.from("subscriptions").update({
status:"canceled"
}).eq("stripe_subscription_id",subscription.id)

break
}

}

res.json({received:true})

}catch(err){
res.status(500).json({error:err.message})
}

}

function buffer(readable){
return new Promise((resolve,reject)=>{
const chunks=[]
readable.on("data",chunk=>chunks.push(chunk))
readable.on("end",()=>resolve(Buffer.concat(chunks)))
readable.on("error",reject)
})
}
