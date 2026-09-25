(function () {
  'use strict';

  const KEY = 'gasguard-v2-service-workflow';
  const VERSION = 'service-workflow-v0.2';
  const TERMINAL = new Set(['completed', 'cancelled']);
  const OPEN = new Set(['submitted', 'acknowledged', 'scheduled', 'in_progress', 'awaiting_verification', 'unable_to_complete']);
  const TRANSITIONS = { submitted:['acknowledged','cancelled'], acknowledged:['scheduled','in_progress','cancelled'], scheduled:['in_progress','cancelled'], in_progress:['awaiting_verification','unable_to_complete'], awaiting_verification:['completed','in_progress','unable_to_complete'], completed:[], cancelled:[], unable_to_complete:['in_progress'] };
  const now = () => new Date().toISOString();
  const clone = value => JSON.parse(JSON.stringify(value));
  const result = (ok, code, message, data = {}) => ({ ok, code, message, ...data });
  const emptyState = warning => ({ version: VERSION, requests: [], tasks: [], verifications: [], reports: [], warning: warning || null, migration: null });
  const browserStorage = () => typeof localStorage === 'undefined' ? null : localStorage;
  const incident = incidentId => window.GasGuardEngine?.state.events.find(event => (event.eventId || event.id) === incidentId) || null;
  const newId = prefix => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

  function normaliseRequest(record = {}) {
    return { requestId:record.requestId || newId('req'), siteId:record.siteId ?? null, incidentId:record.incidentId ?? null, zoneId:record.zoneId ?? null, deviceIds:Array.isArray(record.deviceIds) ? record.deviceIds : [], source:record.source || 'simulation', requestType:record.requestType || 'inspection', title:record.title || 'ขอให้ตรวจสอบระบบ', description:record.description ?? null, priority:record.priority || 'normal', status:TRANSITIONS[record.status] ? record.status : 'submitted', submittedAt:record.submittedAt || null, acknowledgedAt:record.acknowledgedAt || null, scheduledAt:record.scheduledAt || null, startedAt:record.startedAt || null, awaitingVerificationAt:record.awaitingVerificationAt || null, completedAt:record.completedAt || null, cancelledAt:record.cancelledAt || null, requester:record.requester ?? null, requesterRole:record.requesterRole || 'general', assignedTechnician:record.assignedTechnician ?? null, contactPreference:record.contactPreference ?? null, technicianNotes:Array.isArray(record.technicianNotes) ? record.technicianNotes : [], relatedMaintenanceTaskIds:Array.isArray(record.relatedMaintenanceTaskIds) ? record.relatedMaintenanceTaskIds : [], serviceReportId:record.serviceReportId ?? null, history:Array.isArray(record.history) ? record.history : [], createdFrom:record.createdFrom || (record.incidentId ? 'incident' : 'general'), mock:true };
  }

  function migrate(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { state:emptyState('ข้อมูล workflow เดิมอ่านไม่ได้ จึงเริ่มในสถานะกู้คืนได้'), recovered:true };
    try {
      return { recovered:false, state:{ version:VERSION, requests:Array.isArray(raw.requests) ? raw.requests.map(normaliseRequest) : [], tasks:Array.isArray(raw.tasks) ? raw.tasks.map(task => ({ ...task, maintenanceTaskId:task.maintenanceTaskId || newId('mt'), status:task.status || 'open', performedBy:null, actorRole:task.actorRole || 'technician', mock:true })) : [], verifications:Array.isArray(raw.verifications) ? raw.verifications.map(item => ({ ...item, verificationId:item.verificationId || newId('ver'), performedBy:null, actorRole:item.actorRole || 'technician', mock:true })) : [], reports:Array.isArray(raw.reports) ? raw.reports.map(report => ({ ...report, reportId:report.reportId || newId('rpt'), technicianIdentity:null, actorRole:report.actorRole || 'technician', mock:true })) : [], warning:raw.warning || null, migration:raw.version === VERSION ? raw.migration || null : { from:raw.version || 'unversioned', to:VERSION, migratedAt:now() } } };
    } catch (error) { return { state:emptyState('ข้อมูล workflow เดิมย้ายรูปแบบไม่ได้ จึงเริ่มในสถานะกู้คืนได้'), recovered:true }; }
  }

  function load() {
    const store = browserStorage();
    if (!store) return emptyState('Browser storage ไม่พร้อมใช้งาน ข้อมูลอาจไม่คงอยู่หลัง refresh');
    const raw = store.getItem(KEY);
    if (raw == null) return emptyState();
    try { return migrate(JSON.parse(raw)).state; }
    catch (error) { return emptyState('ข้อมูล workflow เดิมอ่านไม่ได้ จึงเริ่มในสถานะกู้คืนได้'); }
  }

  const state = load();
  function replaceState(candidate) { Object.keys(state).forEach(key => delete state[key]); Object.assign(state, candidate); }
  function commit(candidate) {
    const store = browserStorage();
    if (!store) return result(false, 'storage_unavailable', 'ไม่สามารถบันทึกข้อมูลลง Browser storage; ข้อมูลอาจไม่คงอยู่หลัง Refresh');
    try { candidate.version = VERSION; store.setItem(KEY, JSON.stringify(candidate)); replaceState(candidate); return result(true, 'saved', 'บันทึกข้อมูลใน Browser storage แล้ว'); }
    catch (error) { return result(false, 'storage_write_failed', 'ไม่สามารถบันทึกข้อมูลลง Browser storage; ข้อมูลอาจไม่คงอยู่หลัง Refresh'); }
  }
  function save() { return commit(clone(state)); }
  function resetDemoState(candidate) { return commit(clone(candidate || emptyState())); }
  function requestFor(requestId, candidate = state) { return candidate.requests.find(request => request.requestId === requestId) || null; }
  function terminalFailure(request) { if (!request) return result(false, 'request_not_found', 'ไม่พบคำขอบริการนี้'); if (request.status === 'completed') return result(false, 'request_completed', 'งานนี้เสร็จสิ้นแล้ว ไม่สามารถแก้ไขเพิ่มเติมได้'); if (request.status === 'cancelled') return result(false, 'request_cancelled', 'คำขอนี้ถูกยกเลิกแล้ว เปิดอ่านประวัติได้เท่านั้น'); return null; }
  function addHistory(request, action, nextStatus, actorRole) { request.history.push({ timestamp:now(), action, previousStatus:request.status, newStatus:nextStatus, actorRole, mock:true }); }
  function latestVerification(requestId, candidate = state) { return candidate.verifications.find(item => item.requestId === requestId) || null; }

  function create(input = {}) {
    const related = incident(input.incidentId), duplicate = related && state.requests.find(request => request.incidentId === input.incidentId && OPEN.has(request.status));
    if (duplicate) return result(false, 'duplicate_open_request', 'มีคำขอบริการที่ยังเปิดอยู่สำหรับ Incident นี้แล้ว', { request:duplicate, duplicate:true });
    const candidate = clone(state), request = normaliseRequest({ requestId:newId('req'), siteId:input.siteId ?? related?.siteId ?? null, incidentId:input.incidentId ?? null, zoneId:input.zoneId ?? related?.zoneId ?? null, deviceIds:input.deviceIds ?? related?.deviceIds ?? [], source:related?.source || 'simulation', requestType:input.requestType || 'inspection', title:input.title || 'ขอให้ตรวจสอบระบบ', description:input.description ?? null, priority:input.priority || 'normal', status:'submitted', submittedAt:now(), requester:null, requesterRole:'general', contactPreference:input.contactPreference ?? null, createdFrom:input.incidentId ? 'incident' : 'general' });
    addHistory(request, 'submitted', 'submitted', 'general'); candidate.requests.unshift(request);
    const saved = commit(candidate); return saved.ok ? result(true, 'created', 'ส่งคำขอบริการจำลองแล้ว', { request, duplicate:false }) : saved;
  }

  function transition(requestId, nextStatus, actorRole = 'technician') {
    const candidate = clone(state), request = requestFor(requestId, candidate), terminal = terminalFailure(request);
    if (terminal) return terminal;
    if (!TRANSITIONS[request.status]?.includes(nextStatus)) return result(false, 'invalid_transition', 'ไม่สามารถเปลี่ยนสถานะงานในขั้นตอนนี้ได้');
    if (nextStatus === 'completed' && latestVerification(requestId, candidate)?.result !== 'passed') return result(false, 'verification_required', 'ต้องมีผล Verification ผ่านก่อนปิดงาน');
    addHistory(request, `status_${nextStatus}`, nextStatus, actorRole); request.status = nextStatus;
    const timestamp = now(); if (nextStatus === 'acknowledged') request.acknowledgedAt = timestamp; if (nextStatus === 'scheduled') request.scheduledAt = timestamp; if (nextStatus === 'in_progress') request.startedAt = request.startedAt || timestamp; if (nextStatus === 'awaiting_verification') request.awaitingVerificationAt = timestamp; if (nextStatus === 'completed') request.completedAt = timestamp; if (nextStatus === 'cancelled') request.cancelledAt = timestamp;
    const saved = commit(candidate); return saved.ok ? result(true, 'transitioned', 'อัปเดตสถานะงานแล้ว', { request:requestFor(requestId), previousStatus:request.history.at(-1).previousStatus }) : saved;
  }

  function note(requestId, text) { const candidate = clone(state), request = requestFor(requestId, candidate), terminal = terminalFailure(request); if (terminal) return terminal; request.technicianNotes.push({ at:now(), text:String(text || '').trim() || null, actorRole:'technician', mock:true }); const saved = commit(candidate); return saved.ok ? result(true, 'note_saved', 'บันทึกหมายเหตุช่างแล้ว', { request:requestFor(requestId) }) : saved; }
  function task(requestId, input = {}) { const candidate = clone(state), request = requestFor(requestId, candidate), terminal = terminalFailure(request); if (terminal) return terminal; const maintenanceTask = { maintenanceTaskId:newId('mt'), requestId, incidentId:request.incidentId, siteId:request.siteId, zoneId:request.zoneId, deviceId:input.deviceId || request.deviceIds[0] || null, actionType:input.actionType || 'inspect_device', description:input.description ?? null, status:'open', actorRole:'technician', performedBy:null, startedAt:now(), completedAt:null, result:null, notes:input.notes ?? null, evidence:[], mock:true }; candidate.tasks.unshift(maintenanceTask); request.relatedMaintenanceTaskIds.push(maintenanceTask.maintenanceTaskId); const saved = commit(candidate); return saved.ok ? result(true, 'task_created', 'เพิ่มงานตรวจจำลองแล้ว', { task:maintenanceTask, request:requestFor(requestId) }) : saved; }
  function verify(requestId, input = {}) { const candidate = clone(state), request = requestFor(requestId, candidate), terminal = terminalFailure(request); if (terminal) return terminal; const verification = { verificationId:newId('ver'), requestId, incidentId:request.incidentId, performedAt:now(), actorRole:'technician', performedBy:null, testType:input.testType || 'simulation_follow_up', expectedResult:input.expectedResult ?? null, observedResult:input.observedResult ?? null, result:input.result || 'unable_to_test', evidence:[], notes:input.notes ?? null, mock:true }; candidate.verifications = [verification, ...candidate.verifications.filter(item => item.requestId !== requestId)]; if (verification.result === 'passed') candidate.tasks.filter(item => item.requestId === requestId && item.status !== 'completed').forEach(item => { item.status = 'completed'; item.completedAt = verification.performedAt; item.result = 'mock verification passed'; }); const saved = commit(candidate); return saved.ok ? result(true, 'verification_saved', 'บันทึกผล Verification แล้ว', { verification, request:requestFor(requestId) }) : saved; }

  function report(requestId) {
    const existing = state.reports.find(item => item.requestId === requestId); if (existing) return result(true, 'report_exists', 'มี Service Report อยู่แล้ว ระบบเปิดรายงานเดิมให้', { report:existing, existing:true });
    const candidate = clone(state), request = requestFor(requestId, candidate); if (!request) return result(false, 'request_not_found', 'ไม่พบคำขอบริการนี้'); if (request.status === 'cancelled') return result(false, 'request_cancelled', 'คำขอนี้ถูกยกเลิกแล้ว จึงสร้างรายงานไม่ได้'); if (request.status !== 'completed') return result(false, 'request_not_completed', 'ต้องปิดงานให้เสร็จก่อนสร้างรายงาน');
    const verification = latestVerification(requestId, candidate); if (!verification || verification.result !== 'passed') return result(false, 'verification_required', 'ต้องมีผล Verification ผ่านก่อนสร้างรายงาน');
    const relatedIncident = incident(request.incidentId), serviceReport = { reportId:newId('rpt'), requestId, incidentId:request.incidentId, siteId:request.siteId, zoneId:request.zoneId, deviceIds:request.deviceIds, reportedIssue:request.description || request.title, incidentSummary:relatedIncident?.detail ?? null, diagnosticSummary:request.technicianNotes.at(-1)?.text ?? null, actionsPerformed:request.relatedMaintenanceTaskIds, partsReplaced:[], verificationResult:verification.result, detectionStatusAtCompletion:relatedIncident?.lifecycleStatus ?? null, technicianWorkflowResult:request.status, createdAt:now(), completedAt:request.completedAt || null, nextAction:null, technicianIdentity:null, actorRole:'technician', evidenceReferences:[], mock:true };
    candidate.reports.unshift(serviceReport); request.serviceReportId = serviceReport.reportId; const saved = commit(candidate); return saved.ok ? result(true, 'report_created', 'สร้าง Service Report จำลองแล้ว', { report:serviceReport, existing:false }) : saved;
  }

  function relationSnapshot(selection = 'all') {
    const incidentId = selection.startsWith('incident:') ? selection.slice(9) : null;
    const selectedTask = selection.startsWith('task:') ? state.tasks.find(item => item.maintenanceTaskId === selection.slice(5)) : null;
    const selectedVerification = selection.startsWith('verification:') ? state.verifications.find(item => item.verificationId === selection.slice(13)) : null;
    const selectedReport = selection.startsWith('report:') ? state.reports.find(item => item.reportId === selection.slice(7)) : null;
    const requestId = selection.startsWith('request:') ? selection.slice(8) : selectedTask?.requestId || selectedVerification?.requestId || selectedReport?.requestId || null;
    const requests = state.requests.filter(request => !incidentId || request.incidentId === incidentId).filter(request => !requestId || request.requestId === requestId);
    const requestIds = new Set(requests.map(request => request.requestId));
    const incidentIds = new Set(requests.map(request => request.incidentId).filter(Boolean));
    const all = selection === 'all';
    return { version:VERSION, selection, incidents:window.GasGuardEngine?.state.events.filter(event => all || incidentIds.has(event.eventId || event.id)) || [], requests, tasks:state.tasks.filter(task => requestIds.has(task.requestId)), verifications:state.verifications.filter(item => requestIds.has(item.requestId)), reports:state.reports.filter(item => requestIds.has(item.requestId)), warning:state.warning || null, missingRelation:!all&&!requests.length?'ไม่พบความสัมพันธ์ของรายการที่เลือก':null, source:'LOCAL_BROWSER_DATA', mock:true };
  }
  function protectedIncidentIds() { return new Set([...state.requests.filter(request => OPEN.has(request.status)).map(request => request.incidentId), ...state.tasks.filter(task => task.status !== 'completed').map(task => task.incidentId)].filter(Boolean)); }
  window.GasGuardService = { state, KEY, VERSION, create, transition, note, task, verify, report, protectedIncidentIds, relationSnapshot, save, resetDemoState, migrate };
})();
