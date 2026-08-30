import express from "express";
import http from "http";
import {Server} from "socket.io";
import cors from "cors";
const app=express();app.use(cors());app.use(express.json());
const server=http.createServer(app);const io=new Server(server,{cors:{origin:"*"}});
const ROUTES={
 "ROUTE-A":{name:"Route A",stops:[
  {id:"central",name:"Central Market",lat:26.9139,lon:75.7873,scheduled:"08:00"},
  {id:"main",name:"Main Road",lat:26.9178,lon:75.7920,scheduled:"08:08"},
  {id:"square",name:"City Square",lat:26.9225,lon:75.7992,scheduled:"08:16"},
  {id:"gate",name:"University Gate",lat:26.9258,lon:75.8046,scheduled:"08:30"}]},
 "ROUTE-B":{name:"Route B",stops:[
  {id:"north",name:"North Colony",lat:26.9300,lon:75.7810,scheduled:"08:05"},
  {id:"library",name:"City Library",lat:26.9280,lon:75.7920,scheduled:"08:15"},
  {id:"park",name:"Central Park",lat:26.9270,lon:75.8000,scheduled:"08:24"},
  {id:"gate-b",name:"University Gate",lat:26.9258,lon:75.8046,scheduled:"08:34"}]}
};
const boardRequests=new Map();
const buses=new Map([
 ["BUS-07",{busId:"BUS-07",routeId:"ROUTE-A",driverName:"Amit Kumar",plate:"RJ 06 AB 1234",status:"inactive",location:null,updatedAt:null}],
 ["BUS-12",{busId:"BUS-12",routeId:"ROUTE-B",driverName:"Mohan Singh",plate:"RJ 06 CD 5678",status:"scheduled",location:{lat:26.9300,lon:75.7810},updatedAt:new Date().toISOString()}]
]);
const dist=(a,b)=>{const R=6371000,p=Math.PI/180,dLat=(b.lat-a.lat)*p,dLon=(b.lon-a.lon)*p,x=Math.sin(dLat/2)**2+Math.cos(a.lat*p)*Math.cos(b.lat*p)*Math.sin(dLon/2)**2;return 2*R*Math.asin(Math.sqrt(x))};
const calcEta=(bus,stop)=>{if(!bus?.location)return null;const speed=Math.max(5,bus.location.speed>1?bus.location.speed:8.33);const meters=dist(bus.location,stop);return {minutes:Math.max(1,Math.ceil(meters/speed/60)),arrivalAt:new Date(Date.now()+meters/speed*1000).toISOString(),distanceMeters:Math.round(meters),speedKmh:Math.round(speed*3.6)}};
function availableForStop(stopId){
 const results=[];
 for(const b of buses.values()){
  const route=ROUTES[b.routeId];if(!route)continue;
  const stop=route.stops.find(s=>s.id===stopId);if(!stop)continue;
  const e=calcEta(b,stop);
  if(e)results.push({...b,routeName:route.name,stop,e});
  else if(b.status==="scheduled")results.push({...b,routeName:route.name,stop,e:{minutes:15,arrivalAt:new Date(Date.now()+900000).toISOString(),distanceMeters:null,speedKmh:null}});
 }
 return results.sort((a,b)=>a.e.minutes-b.e.minutes);
}
app.get("/api/health",(q,r)=>r.json({ok:true}));
app.get("/api/routes",(q,r)=>r.json(ROUTES));
app.get("/api/next-buses",(q,r)=>{const stopId=q.query.stopId;if(!stopId)return r.status(400).json({error:"stopId required"});r.json({stopId,results:availableForStop(stopId)});});
app.get("/api/buses/:id",(q,r)=>{const b=buses.get(q.params.id);if(!b)return r.status(404).json({error:"Bus not found"});const route=ROUTES[b.routeId];let next=null;if(b.location&&route){next=route.stops.map(s=>({s,e:calcEta(b,s)})).sort((a,b)=>a.e.distanceMeters-b.e.distanceMeters)[0]}r.json({...b,eta:next?{nextStop:next.s.name,...next.e}:null})});
io.on("connection",s=>{
 s.on("driver:register",({driverId,busId="BUS-07"}={})=>{s.join("drivers");s.join("driver-bus:"+busId);s.data.driverId=driverId||"Driver";s.data.busId=busId});
  s.on("student:boardRequest",({requestId,studentId,studentName,busId,routeId,stopId,stopName}={})=>{if(!requestId||!studentId||!busId||!stopName)return;const request={requestId,studentId,studentName:studentName||studentId,busId,routeId,stopId,stopName,createdAt:new Date().toISOString()};boardRequests.set(requestId,request);io.to("driver-bus:"+busId).emit("driver:boardRequest",request);setTimeout(()=>{if(boardRequests.has(requestId)){boardRequests.delete(requestId);io.to("student:"+studentId).emit("student:boardDecision",{requestId,decision:"expired",busId})}},60000);});
  s.on("driver:boardDecision",({requestId,studentId,decision,busId,driverId}={})=>{const request=boardRequests.get(requestId);if(!request)return;boardRequests.delete(requestId);io.to("student:"+studentId).emit("student:boardDecision",{requestId,studentId,decision,busId,driverId,decidedAt:new Date().toISOString()});io.to("driver-bus:"+busId).emit("driver:boardRequestResolved",{requestId});});
  s.on("driver:start",({busId="BUS-07",routeId="ROUTE-A"}={})=>{let b=buses.get(busId)||{busId};b.routeId=routeId;b.status="active";b.updatedAt=new Date().toISOString();buses.set(busId,b);s.join("bus:"+busId);io.emit("fleet:update",Array.from(buses.values()))});
 s.on("driver:location",d=>{if(typeof d.lat!=="number"||typeof d.lon!=="number")return;let b=buses.get(d.busId)||{busId:d.busId,routeId:"ROUTE-A"};b.status="active";b.location={lat:d.lat,lon:d.lon,accuracy:d.accuracy??null,speed:d.speed??null};b.updatedAt=d.timestamp||new Date().toISOString();buses.set(d.busId,b);io.emit("fleet:update",Array.from(buses.values()));io.to("bus:"+d.busId).emit("bus:location",b)});
 s.on("student:watch",({busId="BUS-07",studentId}={})=>{s.join("bus:"+busId);if(studentId)s.join("student:"+studentId);const b=buses.get(busId);if(b)s.emit("bus:status",b);s.emit("fleet:update",Array.from(buses.values()))});
 s.on("driver:end",({busId="BUS-07"}={})=>{const b=buses.get(busId);if(!b)return;b.status="inactive";b.updatedAt=new Date().toISOString();buses.set(busId,b);io.emit("fleet:update",Array.from(buses.values()));io.to("bus:"+busId).emit("bus:status",b)});
});
server.listen(3001,()=>console.log("API: http://localhost:3001"));
