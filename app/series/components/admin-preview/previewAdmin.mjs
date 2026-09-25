// Navigation visibility only. Sensitive actions still require protected Admin APIs.
export async function isPreviewAdmin(client) {
  try {
    const {data,error}=await client.auth.getUser();
    if(error||!data?.user)return false;
    const {data:profile,error:profileError}=await client.from('users').select('is_admin').eq('id',data.user.id).maybeSingle();
    return !profileError && profile?.is_admin===true;
  } catch { return false; }
}
