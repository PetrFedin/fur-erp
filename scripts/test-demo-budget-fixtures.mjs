// Pure fixture admission test. No database, network, secrets or source-data access.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const fixture=JSON.parse(readFileSync(new URL("./demo-budget-fixtures.json",import.meta.url),"utf8"));
const nodes=fixture.budget.nodes;
const pcs=fixture.pcs.rows;
const byId=new Map(nodes.map(n=>[n.id,n]));
assert.equal(byId.size,nodes.length,"duplicate node identifiers");
assert.ok(nodes.length>=6,"budget lacks hierarchy");
const children=new Map();
for(const n of nodes){
  assert.ok(["fur","cat","len","art"].includes(n.kind));
  assert.ok(n.parentId===null || byId.has(n.parentId),"orphan parent");
  if(n.kind==="fur")assert.equal(n.parentId,null);
  if(n.parentId)children.set(n.parentId,(children.get(n.parentId)||0)+1);
}
const leaf=nodes.filter(n=>n.kind!=="fur" && !children.has(n.id));
assert.ok(leaf.length>2,"not enough budget leaves");
for(const n of leaf){
  for(const k of ["pcs","hides","hidePrice","meters","meterPrice","work"]){
    assert.ok(Number.isFinite(n[k])&&n[k]>=0, "Invalid budget value "+k);
  }
  assert.ok(n.pcs>0);
}
const count=leaf.reduce((s,n)=>s+n.pcs,0);
assert.equal(count,pcs.reduce((s,r)=>s+r.pcs,0),"budget/PCS unit mismatch");
assert.ok(fixture.budget.name.includes("Демо"));
assert.ok(fixture.budget.comment.includes("вымышлен"));
assert.ok(fixture.pcs.name.includes("Демо"));
assert.ok(pcs.every(r=>r.st.length===26 && r.avg>=0));
const p=fixture.budget.params;
const total=leaf.reduce((s,n)=>s+n.pcs*((n.hides*n.hidePrice+n.meters*n.meterPrice)*(1+p.c4/100)+n.work),0);
assert.ok(Number.isFinite(total)&&total>0);
const names=[...nodes.map(n=>n.name),...pcs.flatMap(r=>[r.fur,r.cat])].join(" ");
assert.ok(!/Меркури|Mercury|Федин|MVST|Веллмех|Гугл|Google Drive/i.test(names),"confidential names");
console.log(`Synthetic demo budget verified: ${leaf.length} leaves, ${count} units, ${pcs.length} PCS rows, total ${Math.round(total)}.`);
