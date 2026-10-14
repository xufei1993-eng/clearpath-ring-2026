// Evaluation arithmetic only. Metadata is supplied by the user and is not
// proof of capture origin, an unseen scene, or independent test cases.
const truths=new Set(['occupied','clear']);
const statuses=new Set(['obstructed','clear','uncertain']);

export function classifyCase(truth,status){
  if(!truths.has(truth))throw new TypeError('Invalid truth: expected occupied or clear.');
  if(!statuses.has(status))throw new TypeError('Invalid status: expected obstructed, clear, or uncertain.');
  if(truth==='occupied')return {obstructed:'TP',clear:'FN',uncertain:'UP'}[status];
  return {obstructed:'FP',clear:'TN',uncertain:'UN'}[status];
}

export function summarizeCases(rows){
  if(!Array.isArray(rows))throw new TypeError('Evaluation rows must be an array.');
  const counts={TP:0,FN:0,FP:0,TN:0,UP:0,UN:0};
  const groups=new Map(),durations=[];
  let declaredEligible=true;
  for(let index=0;index<rows.length;index++){
    const row=rows[index];
    if(!row||typeof row!=='object'||Array.isArray(row))throw new TypeError(`Row ${index+1} must be an evaluation object.`);
    const classification=classifyCase(row.truth,row.status);
    if(typeof row.groupId!=='string'||!row.groupId.trim())throw new TypeError(`Row ${index+1} needs a nonempty groupId.`);
    const groupId=row.groupId.trim();
    let group=groups.get(groupId);
    if(!group){group=new Set();groups.set(groupId,group);}
    if(group.has(row.truth))throw new TypeError(`Row ${index+1} repeats the same groupId and truth.`);
    group.add(row.truth);
    counts[classification]++;
    if(typeof row.elapsedMs==='number'&&Number.isFinite(row.elapsedMs)&&row.elapsedMs>=0)durations.push(row.elapsedMs);
    if(row.source!=='self_recorded'||row.split!=='unseen'||row.independentDeclared!==true)declaredEligible=false;
  }
  const total=rows.length;
  const positiveTotal=counts.TP+counts.FN+counts.UP;
  const negativeTotal=counts.FP+counts.TN+counts.UN;
  const ratio=(numerator,denominator)=>denominator?numerator/denominator:null;
  const coverage=ratio(total-counts.UP-counts.UN,total);
  const occupancyAlertRate=ratio(counts.TP,positiveTotal);
  const clearConfirmationRate=ratio(counts.TN,negativeTotal);
  const falseAlertRate=ratio(counts.FP,negativeTotal);
  const completeGroupCount=[...groups.values()].filter(group=>group.size===2).length;
  durations.sort((left,right)=>left-right);
  const middle=Math.floor(durations.length/2);
  const medianMs=durations.length?(durations.length%2?durations[middle]:durations[middle-1]/2+durations[middle]/2):null;
  const maxMs=durations.length?durations[durations.length-1]:null;
  return {
    counts,total,positiveTotal,negativeTotal,groupCount:groups.size,completeGroupCount,
    coverage,occupancyAlertRate,clearConfirmationRate,falseAlertRate,medianMs,maxMs,
    numericGateMet:completeGroupCount>=10&&declaredEligible&&occupancyAlertRate>=0.9&&clearConfirmationRate>=0.9,
    evidenceStatus:'self_declared_unverified',
  };
}
