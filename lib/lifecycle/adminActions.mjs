const endpoints={
 publish:'/api/admin/regular-final-publication',
 transition:'/api/admin/lifecycle-transition',
};
export async function requestLifecycleAction(client,{action,context,confirmed},fetcher=fetch){
 if(confirmed!==true)throw new Error('Confirmation explicite requise.');
 if(!endpoints[action])throw new Error('Action invalide.');
 const {data,error}=await client.auth.getSession();
 if(error||!data.session)throw new Error('Connecte-toi avec un compte administrateur.');
 const response=await fetcher(endpoints[action],{
  method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${data.session.access_token}`},
  body:JSON.stringify({confirm:true,season:context.current_season,revision:context.revision}),
 });
 const result=await response.json();
 if(!response.ok)throw new Error(result.error||'Opération refusée.');
 return result;
}
