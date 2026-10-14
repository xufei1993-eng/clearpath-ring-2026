import {test} from 'node:test';
import assert from 'node:assert/strict';
import {classifyCase,summarizeCases} from '../dist/metrics.mjs';

const row=(groupId,truth,status,extra={})=>({groupId,truth,status,source:'self_recorded',split:'unseen',independentDeclared:true,...extra});
function cohort(size=10){return Array.from({length:size},(_,index)=>[row(`scene-${index}`,'occupied','obstructed'),row(`scene-${index}`,'clear','clear')]).flat();}

test('all six outcomes include separate uncertain positive and uncertain negative cases',()=>{
  assert.equal(classifyCase('occupied','obstructed'),'TP');
  assert.equal(classifyCase('occupied','clear'),'FN');
  assert.equal(classifyCase('occupied','uncertain'),'UP');
  assert.equal(classifyCase('clear','obstructed'),'FP');
  assert.equal(classifyCase('clear','clear'),'TN');
  assert.equal(classifyCase('clear','uncertain'),'UN');
});

test('invalid labels throw instead of silently dropping samples',()=>{
  for(const truth of [undefined,null,'',true,'Occupied','blocked','uncertain'])assert.throws(()=>classifyCase(truth,'clear'),TypeError);
  for(const status of [undefined,null,'',false,'Clear','occupied','error'])assert.throws(()=>classifyCase('clear',status),TypeError);
  assert.throws(()=>summarizeCases([...cohort(),row('extra','occupied','not_a_result')]),TypeError);
});

test('empty data reports N/A rates and durations, with no numerical success',()=>{
  assert.deepEqual(summarizeCases([]),{
    counts:{TP:0,FN:0,FP:0,TN:0,UP:0,UN:0},total:0,positiveTotal:0,negativeTotal:0,groupCount:0,completeGroupCount:0,
    coverage:null,occupancyAlertRate:null,clearConfirmationRate:null,falseAlertRate:null,medianMs:null,maxMs:null,
    numericGateMet:false,evidenceStatus:'self_declared_unverified',
  });
});

test('uncertain outcomes remain in every applicable rate denominator',()=>{
  const summary=summarizeCases([
    row('a','occupied','obstructed'),row('a','clear','clear'),
    row('b','occupied','clear'),row('b','clear','obstructed'),
    row('c','occupied','uncertain'),row('c','clear','uncertain'),
  ]);
  assert.deepEqual(summary.counts,{TP:1,FN:1,FP:1,TN:1,UP:1,UN:1});
  assert.equal(summary.total,6);
  assert.equal(summary.positiveTotal,3);assert.equal(summary.negativeTotal,3);
  assert.equal(summary.coverage,4/6);
  assert.equal(summary.occupancyAlertRate,1/3);
  assert.equal(summary.clearConfirmationRate,1/3);
  assert.equal(summary.falseAlertRate,1/3);
});

test('twenty uncertain cases never count as correct or pass the numerical threshold',()=>{
  const summary=summarizeCases(cohort().map(item=>({...item,status:'uncertain'})));
  assert.equal(summary.completeGroupCount,10);
  assert.deepEqual(summary.counts,{TP:0,FN:0,FP:0,TN:0,UP:10,UN:10});
  assert.equal(summary.coverage,0);
  assert.equal(summary.occupancyAlertRate,0);
  assert.equal(summary.clearConfirmationRate,0);
  assert.equal(summary.falseAlertRate,0);
  assert.equal(summary.numericGateMet,false);
});

test('a cohort containing only one truth reports the absent rate as N/A',()=>{
  const positive=summarizeCases([row('a','occupied','obstructed')]);
  assert.equal(positive.occupancyAlertRate,1);
  assert.equal(positive.clearConfirmationRate,null);
  assert.equal(positive.falseAlertRate,null);
  const negative=summarizeCases([row('b','clear','clear')]);
  assert.equal(negative.occupancyAlertRate,null);
  assert.equal(negative.clearConfirmationRate,1);
  assert.equal(negative.falseAlertRate,0);
  assert.equal(negative.numericGateMet,false);
});

test('repeated group and truth, including whitespace variants, are rejected',()=>{
  const first=row('scene','occupied','obstructed');
  assert.throws(()=>summarizeCases([first,{...first}]),/repeats/);
  assert.throws(()=>summarizeCases([first,{...first,status:'uncertain'}]),/repeats/);
  assert.throws(()=>summarizeCases([first,{...first,groupId:' scene '}]),/repeats/);
  assert.equal(summarizeCases([first,row('scene','clear','clear')]).completeGroupCount,1);
});

test('malformed rows and empty group identifiers fail the entire summary',()=>{
  for(const rows of [null,{},'rows'])assert.throws(()=>summarizeCases(rows),TypeError);
  for(const invalid of [null,undefined,[],42])assert.throws(()=>summarizeCases([invalid]),TypeError);
  for(const groupId of ['', '   ',undefined,null,1])assert.throws(()=>summarizeCases([row(groupId,'clear','clear')]),/groupId/);
});

test('complete independent groups are counted as pairs, not as individual frames',()=>{
  const incomplete=Array.from({length:20},(_,index)=>row(`scene-${index}`,'occupied','obstructed'));
  const summary=summarizeCases(incomplete);
  assert.equal(summary.groupCount,20);assert.equal(summary.completeGroupCount,0);
  assert.equal(summary.numericGateMet,false);
  assert.equal(summarizeCases(cohort(9)).numericGateMet,false);
  assert.equal(summarizeCases(cohort(10)).numericGateMet,true);
});

test('both required rates must meet 90 percent, with uncertainty reducing the rates',()=>{
  const rows=cohort();
  rows[0].status='uncertain';rows[1].status='obstructed';
  const boundary=summarizeCases(rows);
  assert.equal(boundary.occupancyAlertRate,0.9);
  assert.equal(boundary.clearConfirmationRate,0.9);
  assert.equal(boundary.numericGateMet,true);
  rows[2].status='clear';
  assert.equal(summarizeCases(rows).numericGateMet,false);
  rows[2].status='obstructed';rows[3].status='uncertain';
  assert.equal(summarizeCases(rows).numericGateMet,false);
});

test('synthetic, seen, or undeclared samples cannot pass despite perfect predictions',()=>{
  for(const extra of [{source:'synthetic_sample'},{source:'ring_playground'},{source:'user_media'},{split:'seen'},{split:undefined},{independentDeclared:false},{independentDeclared:'true'}]){
    const rows=cohort();Object.assign(rows[0],extra);
    const summary=summarizeCases(rows);
    assert.equal(summary.occupancyAlertRate,1);
    assert.equal(summary.clearConfirmationRate,1);
    assert.equal(summary.numericGateMet,false,JSON.stringify(extra));
    assert.equal(summary.evidenceStatus,'self_declared_unverified');
  }
  assert.equal(summarizeCases(cohort()).evidenceStatus,'self_declared_unverified');
});

test('duration median and maximum use only finite nonnegative numbers without dropping cases',()=>{
  const durations=[0,10,20,100,null,undefined,'30',NaN,Infinity,-1];
  const rows=durations.map((elapsedMs,index)=>row(`scene-${index}`,'clear','clear',{elapsedMs}));
  const before=rows.map(item=>({...item}));
  const summary=summarizeCases(rows);
  assert.equal(summary.total,10);assert.equal(summary.counts.TN,10);
  assert.equal(summary.medianMs,15);assert.equal(summary.maxMs,100);
  assert.deepEqual(rows,before);
  assert.equal(summarizeCases(rows.slice(0,3)).medianMs,10);
  const invalid=summarizeCases(rows.slice(4));
  assert.equal(invalid.medianMs,null);assert.equal(invalid.maxMs,null);
});

test('even-duration median stays finite for very large valid measurements',()=>{
  const summary=summarizeCases([row('a','clear','clear',{elapsedMs:Number.MAX_VALUE}),row('b','clear','clear',{elapsedMs:Number.MAX_VALUE})]);
  assert.equal(summary.medianMs,Number.MAX_VALUE);
  assert.equal(summary.maxMs,Number.MAX_VALUE);
});
