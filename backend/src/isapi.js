// Hikvision ISAPI wrapper for access-control terminals (DS-K1T320 / MinMoe family).
// All person/credential operations go through here. Devices enforce Valid Period
// natively, so time-limited access is reliable even if this server is offline.
import { digestRequest } from './digestClient.js';

function deviceBaseUrl(device) {
  const proto = device.use_https ? 'https' : 'http';
  const port = device.port || (device.use_https ? 443 : 80);
  return `${proto}://${device.host}:${port}`;
}

async function req(device, method, path, { json, xml, headers, timeout } = {}) {
  let body;
  const h = { ...(headers || {}) };
  if (json !== undefined) {
    body = JSON.stringify(json);
    h['Content-Type'] = 'application/json';
  } else if (xml !== undefined) {
    body = xml;
    h['Content-Type'] = 'application/xml';
  }
  const res = await digestRequest({
    baseUrl: deviceBaseUrl(device),
    username: device.username,
    password: device.password,
    method,
    path,
    body,
    headers: h,
    timeout,
  });
  return res;
}

// ---- Connectivity / device info -------------------------------------------

export async function getDeviceInfo(device) {
  const res = await req(device, 'GET', '/ISAPI/System/deviceInfo?format=json');
  if (!res.ok) throw new Error(`deviceInfo failed (${res.status}): ${res.text.slice(0, 200)}`);
  // Many MinMoe units ignore ?format=json and return XML — parse either shape.
  const j = res.json();
  const info = j?.DeviceInfo || {};
  const xml = (tag) => (info[tag] !== undefined ? info[tag] : xmlTag(res.text, tag));
  return {
    deviceName: xml('deviceName'),
    model: xml('model'),
    serialNumber: xml('serialNumber'),
    firmwareVersion: xml('firmwareVersion'),
    macAddress: xml('macAddress'),
  };
}

// Map Hik ISAPI status codes to human-readable messages for the dashboard.
const HIK_MESSAGES = {
  employeeNoAlreadyExist: 'That employee number already exists on this machine.',
  employeeNoNotExist: 'That user does not exist on this machine.',
  userExceedLimit: 'This machine has reached its user limit.',
  cardNoAlreadyExist: 'That card is already assigned on this machine.',
  duplicateCardNo: 'That card is already assigned on this machine.',
  cardNoExist: 'That card is already assigned on this machine.',
  cardNumOverLimit: 'This machine has reached its card limit.',
  cardNumFull: 'This machine has reached its card limit.',
  fingerPrintDataExist: 'This fingerprint is already enrolled on this machine.',
  duplicateFingerPrint: 'This fingerprint is already enrolled for another user.',
  fingerPrintNumOverLimit: 'This machine has reached its fingerprint limit.',
  faceDataExist: 'A face is already enrolled for this user.',
  deviceError: 'Nothing was presented at the reader, or the device reported an error. Try again.',
  deviceBusy: 'The machine is busy — a previous card/fingerprint capture is still open. Wait about 30 seconds and try again.',
  methodNotAllowed: 'This operation is not allowed on this machine.',
  notSupport: 'This machine does not support that operation.',
  badJsonContent: 'The machine rejected the request format.',
  badXmlContent: 'The machine rejected the request format.',
  invalidContent: 'The machine rejected the request content.',
  notActivated: 'The machine is not activated.',
  riskPassword: 'The machine reports a weak/risky password.',
};

// Turn an interpret()/capture result into a friendly, machine-aware message.
export function describe(result) {
  if (!result) return 'Unknown device error';
  if (result.error) return result.error;
  const sub = result.subStatusCode;
  if (sub && HIK_MESSAGES[sub]) return HIK_MESSAGES[sub];
  if (result.statusString && result.statusString !== 'Invalid Operation') return result.statusString;
  return sub || (result.httpStatus ? `Device returned HTTP ${result.httpStatus}` : 'Device error');
}

// Extract the text of the first <tag>…</tag> from a (namespaced) XML string.
function xmlTag(text, tag) {
  if (!text) return undefined;
  const m = text.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i'));
  return m ? m[1].trim() : undefined;
}

// Write the server's current time + timezone to the device. Prevents the
// "expired" false-positives caused by drifted terminal clocks.
export async function setDeviceTime(device, date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const offMin = -date.getTimezoneOffset(); // minutes east of UTC, e.g. +300 for UTC+5
  const abs = Math.abs(offMin);
  const oh = p(Math.floor(abs / 60));
  const om = p(abs % 60);
  const sign = offMin >= 0 ? '+' : '-';
  const local = `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}${sign}${oh}:${om}`;
  // Hikvision's timeZone string is inverted: CST-5:00:00 means UTC+5.
  const tz = `CST${offMin >= 0 ? '-' : '+'}${Math.floor(abs / 60)}:${om}:00`;
  const xml = `<Time><timeMode>manual</timeMode><localTime>${local}</localTime><timeZone>${tz}</timeZone></Time>`;
  const res = await req(device, 'PUT', '/ISAPI/System/time', { xml });
  return interpret(res, 'setDeviceTime');
}

// Prompt the terminal to capture a face with its own camera (it shows the face
// enrollment UI). Each round long-polls ~8s; returns the JPEG on success.
export async function captureFace(device, { rounds = 4, timeout = 20000 } = {}) {
  const xml =
    '<CaptureFaceDataCond version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema">' +
    '<captureInfrared>false</captureInfrared><dataType>binary</dataType></CaptureFaceDataCond>';
  for (let i = 0; i < rounds; i++) {
    const res = await digestRequest({
      baseUrl: deviceBaseUrl(device),
      username: device.username,
      password: device.password,
      method: 'POST',
      path: '/ISAPI/AccessControl/CaptureFaceData',
      body: xml,
      headers: { 'Content-Type': 'application/xml' },
      timeout,
    });
    // On success the body contains the raw JPEG (possibly inside multipart).
    const buf = res.body;
    const start = buf.indexOf(Buffer.from([0xff, 0xd8]));
    const end = buf.lastIndexOf(Buffer.from([0xff, 0xd9]));
    if (start !== -1 && end > start) return { ok: true, jpeg: buf.subarray(start, end + 2) };
    const sub = xmlTag(res.text, 'subStatusCode');
    if (sub && !['deviceError', 'ok'].includes(sub)) return { ok: false, error: describe({ subStatusCode: sub }) };
    // captureProgress 0 → nobody presented a face this round; keep waiting.
  }
  return { ok: false, error: 'No face was captured — stand in front of the machine camera and try again.' };
}

export async function getCapabilities(device) {
  // Reports whether the unit supports face / fingerprint / card, and person counts.
  const res = await req(device, 'GET', '/ISAPI/AccessControl/capabilities?format=json');
  return res.ok ? res.json() : null;
}

// ---- Person (UserInfo) -----------------------------------------------------

/**
 * Create or update a person on the device.
 * validBegin/validEnd are ISO-ish local strings "YYYY-MM-DDTHH:mm:ss".
 */
export async function upsertPerson(device, person, mode = 'add') {
  const record = {
    UserInfo: {
      employeeNo: String(person.employeeNo),
      name: person.name,
      userType: 'normal',
      Valid: {
        // enabled:false blocks the person at the door while keeping their
        // profile, cards and fingerprints enrolled on the machine.
        enable: person.enabled === false ? false : true,
        beginTime: person.validBegin,
        endTime: person.validEnd,
        timeType: 'local',
      },
      // localUIRight = access level: true → admin (can enter the terminal menu),
      // false → normal user (door access only).
      localUIRight: !!person.admin,
      doorRight: person.doorRight || '1',
      RightPlan: person.rightPlan || [{ doorNo: 1, planTemplateNo: '1' }],
    },
  };
  // Add uses POST /Record; Modify uses PUT /Modify (POST → methodNotAllowed).
  const path =
    mode === 'add'
      ? '/ISAPI/AccessControl/UserInfo/Record?format=json'
      : '/ISAPI/AccessControl/UserInfo/Modify?format=json';
  const method = mode === 'add' ? 'POST' : 'PUT';
  const res = await req(device, method, path, { json: record });
  return interpret(res, `upsertPerson(${mode})`);
}

export async function deletePerson(device, employeeNo) {
  const body = {
    UserInfoDelCond: {
      EmployeeNoList: [{ employeeNo: String(employeeNo) }],
    },
  };
  const res = await req(device, 'PUT', '/ISAPI/AccessControl/UserInfo/Delete?format=json', {
    json: body,
  });
  return interpret(res, 'deletePerson');
}

export async function getPerson(device, employeeNo) {
  const body = {
    UserInfoSearchCond: {
      searchID: '1',
      searchResultPosition: 0,
      maxResults: 1,
      EmployeeNoList: [{ employeeNo: String(employeeNo) }],
    },
  };
  const res = await req(device, 'POST', '/ISAPI/AccessControl/UserInfo/Search?format=json', {
    json: body,
  });
  const j = res.json();
  return j?.UserInfoSearch?.UserInfo?.[0] || null;
}

// Page through the persons enrolled ON the device. Returns one page.
export async function searchPersons(device, position = 0, maxResults = 30) {
  const body = {
    UserInfoSearchCond: { searchID: 'hik-dash', searchResultPosition: position, maxResults },
  };
  const res = await req(device, 'POST', '/ISAPI/AccessControl/UserInfo/Search?format=json', {
    json: body,
  });
  if (!res.ok) throw new Error(`user search failed (${res.status}): ${res.text.slice(0, 160)}`);
  const s = (res.json() || {}).UserInfoSearch || {};
  return {
    total: Number(s.totalMatches || 0),
    status: s.responseStatusStrg,
    list: s.UserInfo || [],
  };
}

// Page through the terminal's own access-event log (entries, door events).
export async function searchEvents(device, position = 0, maxResults = 30) {
  const body = {
    AcsEventCond: { searchID: 'hik-dash-ev', searchResultPosition: position, maxResults, major: 5, minor: 0 },
  };
  const res = await req(device, 'POST', '/ISAPI/AccessControl/AcsEvent?format=json', { json: body });
  if (!res.ok) throw new Error(`event search failed (${res.status}): ${res.text.slice(0, 160)}`);
  const s = (res.json() || {}).AcsEvent || {};
  return { total: Number(s.totalMatches || 0), list: s.InfoList || [] };
}

// ---- Remote door control ---------------------------------------------------

// cmd: open | close | alwaysOpen | alwaysClose. Door endpoints speak XML.
// The terminal serves one request at a time, so a busy device can time out a
// first attempt — retry once before reporting failure.
export async function remoteControlDoor(device, cmd = 'open', doorNo = 1) {
  const xml = `<RemoteControlDoor><cmd>${cmd}</cmd></RemoteControlDoor>`;
  const path = `/ISAPI/AccessControl/RemoteControl/door/${doorNo}`;
  try {
    const res = await req(device, 'PUT', path, { xml });
    return interpret(res, `remoteControlDoor(${cmd})`);
  } catch {
    const res = await req(device, 'PUT', path, { xml });
    return interpret(res, `remoteControlDoor(${cmd})`);
  }
}

// ---- Card ------------------------------------------------------------------

export async function addCard(device, employeeNo, cardNo) {
  const body = {
    CardInfo: {
      employeeNo: String(employeeNo),
      cardNo: String(cardNo),
      cardType: 'normalCard',
    },
  };
  const res = await req(device, 'POST', '/ISAPI/AccessControl/CardInfo/Record?format=json', {
    json: body,
  });
  return interpret(res, 'addCard');
}

// Read the card number(s) enrolled for one person on the device.
export async function readCards(device, employeeNo) {
  const body = {
    CardInfoSearchCond: {
      searchID: 'hik-dash',
      searchResultPosition: 0,
      maxResults: 30,
      EmployeeNoList: [{ employeeNo: String(employeeNo) }],
    },
  };
  const res = await req(device, 'POST', '/ISAPI/AccessControl/CardInfo/Search?format=json', {
    json: body,
  });
  const list = (res.json() || {}).CardInfoSearch?.CardInfo || [];
  return list.map((c) => String(c.cardNo));
}

// Read the fingerprint template(s) for one person (base64 fingerData).
export async function readFingerprints(device, employeeNo) {
  // NOTE: do NOT send cardReaderNo here — this firmware answers "NoFP" when it
  // is present, but returns the full template list when it's omitted.
  const body = {
    FingerPrintCond: { searchID: 'hik-dash', employeeNo: String(employeeNo) },
  };
  const res = await req(device, 'POST', '/ISAPI/AccessControl/FingerPrintUpload?format=json', {
    json: body,
  });
  const list = (res.json() || {}).FingerPrintInfo?.FingerPrintList || [];
  return list
    .filter((f) => f.fingerData)
    .map((f) => ({ fingerPrintID: f.fingerPrintID || 1, fingerData: f.fingerData }));
}

// Page through ALL cards enrolled on a device (cardNo + employeeNo pairs).
export async function readAllCards(device, position = 0, maxResults = 30) {
  const body = {
    CardInfoSearchCond: { searchID: 'hik-dash-cards', searchResultPosition: position, maxResults },
  };
  const res = await req(device, 'POST', '/ISAPI/AccessControl/CardInfo/Search?format=json', {
    json: body,
  });
  if (!res.ok) throw new Error(`card search failed (${res.status})`);
  const s = (res.json() || {}).CardInfoSearch || {};
  return { total: Number(s.totalMatches || 0), list: s.CardInfo || [] };
}

// Ask the terminal to read a card at its reader (long-poll ~10s per round), then
// return the card number. Rounds give the person time to present the card.
export async function captureCard(device, { rounds = 3, timeout = 15000 } = {}) {
  for (let i = 0; i < rounds; i++) {
    const res = await req(device, 'GET', '/ISAPI/AccessControl/CaptureCardInfo?format=json', { timeout });
    const j = res.json();
    const cardNo =
      j?.CardInfo?.cardNo || j?.CaptureCardInfo?.cardNo || j?.cardNo || xmlTag(res.text, 'cardNo');
    if (cardNo && String(cardNo).trim()) return { ok: true, cardNo: String(cardNo).trim() };
    // "deviceError" here just means no card was presented in that round — keep waiting.
    const sub = j?.subStatusCode || xmlTag(res.text, 'subStatusCode');
    if (sub && !['deviceError', 'ok'].includes(sub))
      return { ok: false, error: describe({ subStatusCode: sub, statusString: j?.statusString }) };
  }
  return { ok: false, error: 'No card was presented at the reader — tap the card and try again.' };
}

export async function deleteCard(device, cardNo) {
  const body = { CardInfoDelCond: { CardNoList: [{ cardNo: String(cardNo) }] } };
  const res = await req(device, 'PUT', '/ISAPI/AccessControl/CardInfo/Delete?format=json', {
    json: body,
  });
  return interpret(res, 'deleteCard');
}

// ---- Face ------------------------------------------------------------------

// Upload a face by binary image. faceLibType default is blackFD (access face lib).
export async function addFaceByUrl(device, employeeNo, imageUrl) {
  const body = {
    faceURL: imageUrl,
    faceLibType: 'blackFD',
    FDID: '1',
    FPID: String(employeeNo),
  };
  const res = await req(device, 'POST', '/ISAPI/Intelligent/FDLib/FaceDataRecord?format=json', {
    json: body,
  });
  return interpret(res, 'addFaceByUrl');
}

// Upload a face by raw JPEG buffer via multipart. Some firmware requires this form.
export async function addFaceByImage(device, employeeNo, jpegBuffer) {
  const boundary = '----HikBoundary' + Date.now();
  const meta = JSON.stringify({
    faceLibType: 'blackFD',
    FDID: '1',
    FPID: String(employeeNo),
  });
  const parts = [];
  parts.push(Buffer.from(`--${boundary}\r\n`));
  parts.push(
    Buffer.from(
      'Content-Disposition: form-data; name="FaceDataRecord";\r\n' +
        'Content-Type: application/json\r\n\r\n'
    )
  );
  parts.push(Buffer.from(meta + '\r\n'));
  parts.push(Buffer.from(`--${boundary}\r\n`));
  parts.push(
    Buffer.from(
      'Content-Disposition: form-data; name="FaceImage"; filename="face.jpg";\r\n' +
        'Content-Type: image/jpeg\r\n\r\n'
    )
  );
  parts.push(jpegBuffer);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  const body = Buffer.concat(parts);
  const res = await digestRequest({
    baseUrl: deviceBaseUrl(device),
    username: device.username,
    password: device.password,
    method: 'POST',
    path: '/ISAPI/Intelligent/FDLib/FaceDataRecord?format=json',
    body,
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
  });
  return interpret(res, 'addFaceByImage');
}

// Read the enrolled face template(s) for one person from the device's face
// library. This firmware blocks downloading the face PICTURE, but exports the
// recognition template (modelData), which other machines accept for enrollment.
export async function readFaces(device, employeeNo) {
  const faces = [];
  let pos = 0;
  for (let i = 0; i < 20; i++) {
    const res = await req(device, 'POST', '/ISAPI/Intelligent/FDLib/FDSearch?format=json', {
      json: { searchResultPosition: pos, maxResults: 30, FDID: '1', faceLibType: 'blackFD' },
    });
    if (!res.ok) break;
    const j = res.json() || {};
    const list = j.MatchList || [];
    for (const m of list) {
      if (String(m.FPID) === String(employeeNo) && m.modelData) faces.push({ modelData: m.modelData });
    }
    pos += list.length;
    if (!list.length || pos >= Number(j.totalMatches || 0)) break;
  }
  return faces;
}

// Enroll a face on a device from a recognition template (no photo needed).
export async function addFaceByModel(device, employeeNo, modelData) {
  const res = await req(device, 'POST', '/ISAPI/Intelligent/FDLib/FaceDataRecord?format=json', {
    json: { faceLibType: 'blackFD', FDID: '1', FPID: String(employeeNo), modelData },
  });
  return interpret(res, 'addFaceByModel');
}

export async function deleteFace(device, employeeNo) {
  const body = { FPID: [{ value: String(employeeNo) }] };
  const res = await req(
    device,
    'PUT',
    '/ISAPI/Intelligent/FDLib/FDSearch/Delete?format=json&FDID=1&faceLibType=blackFD',
    { json: body }
  );
  return interpret(res, 'deleteFace');
}

// ---- Fingerprint -----------------------------------------------------------

// Push an already-captured fingerprint template (base64) to the device.
export async function addFingerprint(device, employeeNo, fingerData, fingerNo = 1) {
  const body = {
    FingerPrintCfg: {
      employeeNo: String(employeeNo),
      enableCardReader: [1],
      fingerPrintID: fingerNo,
      fingerType: 'normalFP',
      fingerData, // base64 template
    },
  };
  const res = await req(device, 'POST', '/ISAPI/AccessControl/FingerPrint/SetUp?format=json', {
    json: body,
  });
  // SetUp reports per-reader status, not the usual statusCode. cardReaderRecvStatus
  // === 1 means the template was accepted; anything else is a failure.
  const st = (res.json() || {}).FingerPrintStatus?.StatusList;
  if (Array.isArray(st)) {
    const okAll = st.length > 0 && st.every((s) => Number(s.cardReaderRecvStatus) === 1);
    return {
      ok: res.ok && okAll,
      op: 'addFingerprint',
      httpStatus: res.status,
      statusString: okAll ? 'OK' : `cardReaderRecvStatus ${st.map((s) => s.cardReaderRecvStatus).join(',')}`,
      raw: res.json(),
    };
  }
  return interpret(res, 'addFingerprint');
}

// Ask a device to capture a fingerprint from its own sensor (enrollment helper).
// This prompts the person at the terminal to press their finger, so allow time.
// This endpoint speaks XML (JSON → badXmlContent), request and response.
export async function captureFingerprint(device, fingerNo = 1, timeout = 45000) {
  const xml = `<CaptureFingerPrintCond><fingerNo>${fingerNo}</fingerNo></CaptureFingerPrintCond>`;
  const res = await req(device, 'POST', '/ISAPI/AccessControl/CaptureFingerPrint', { xml, timeout });
  const fingerData = xmlTag(res.text, 'fingerData') || res.json()?.CaptureFingerPrint?.fingerData;
  const quality = xmlTag(res.text, 'fingerPrintQuality');
  if (fingerData) return { ok: true, fingerNo, fingerData, quality };
  return { ok: false, ...interpret(res, 'captureFingerprint') };
}

export async function deleteFingerprint(device, employeeNo) {
  const body = {
    FingerPrintDelete: {
      mode: 'byEmployeeNo',
      EmployeeNoDetail: [{ employeeNo: String(employeeNo) }],
    },
  };
  const res = await req(device, 'PUT', '/ISAPI/AccessControl/FingerPrintDelete?format=json', {
    json: body,
  });
  return interpret(res, 'deleteFingerprint');
}

// ---------------------------------------------------------------------------

function interpret(res, op) {
  const j = res.json();
  // Some endpoints (door control, and older firmware) answer in XML, not JSON.
  let statusCode = j?.statusCode;
  let statusString = j?.statusString;
  let subStatusCode = j?.subStatusCode;
  if (statusCode === undefined && res.text) {
    const sc = xmlTag(res.text, 'statusCode');
    if (sc !== undefined) statusCode = Number(sc);
    statusString = xmlTag(res.text, 'statusString') || statusString;
    subStatusCode = xmlTag(res.text, 'subStatusCode') || subStatusCode;
  }
  const ok = res.ok && (statusCode === undefined || statusCode === 1);
  return {
    ok,
    op,
    httpStatus: res.status,
    statusCode,
    statusString,
    subStatusCode,
    raw: j || res.text.slice(0, 300),
  };
}
