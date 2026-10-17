// Retired subscription endpoint: never read credentials or return calendar data.
export const dynamic='force-dynamic';
export function GET(){return Response.json({error:'Die externe Kalenderanbindung wurde entfernt.'},{status:410,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}
export const POST=GET;
