const base="https://sandbox.plaid.com";
const headers={"Content-Type":"application/json","PLAID-CLIENT-ID":process.env.PLAID_CLIENT_ID,"PLAID-SECRET":process.env.PLAID_SECRET};
async function plaid(path,body){const r=await fetch(base+path,{method:"POST",headers,body:JSON.stringify(body)});const j=await r.json();if(!r.ok)throw Error(path+" "+JSON.stringify(j));return j}
const people=["Ava","Ben","Cara","Dylan"],out=[];
for(let i=0;i<people.length;i++){
 const p=await plaid("/sandbox/public_token/create",{institution_id:"ins_109508",initial_products:["transactions"]});
 const item=await plaid("/item/public_token/exchange",{public_token:p.public_token});
 await plaid("/sandbox/transactions/create",{access_token:item.access_token,transactions:[{amount:i===1?89.99:159.99,date_transacted:new Date().toISOString().slice(0,10),date_posted:new Date().toISOString().slice(0,10),description:"NORTH & CO",iso_currency_code:"GBP"}]});
 const tx=await plaid("/transactions/get",{access_token:item.access_token,start_date:new Date(Date.now()-604800000).toISOString().slice(0,10),end_date:new Date().toISOString().slice(0,10)});
 const match=tx.transactions.find(t=>/NORTH/i.test(t.name)&&Math.round(t.amount*100)===(i===1?8999:15999));
 out.push({customer:people[i],found:!!match,fields:match?{name:match.name,merchant_name:match.merchant_name,amount:match.amount,date:match.date,authorized_date:match.authorized_date,payment_meta:match.payment_meta,transaction_id:match.transaction_id,account_id:match.account_id}:null});
}
console.log(JSON.stringify(out,null,2));
