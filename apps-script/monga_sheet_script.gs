/**
 * Monga 응답 수집 + 추천 학습용 Apps Script (v6)
 *
 * [받는 데이터 (POST)]
 *  1) 결과(kind: "result")      → 첫 번째 시트: 전체·주간 체크 결과
 *  2) 체크인(kind: "checkin")    → "체크인" 시트: 주간 활동 수행 / 미수행 / 다른 추천 요청
 *  3) 동의·철회(kind: "consent") → "동의기록" 시트
 *  4) 활동 제안(kind: "suggest") → "활동제안" 시트 (운영자가 '승인' 열에 Y를 넣으면 추천에 반영)
 *  5) 이용 기록(kind: "event")   → "이벤트" 시트: 결과 이미지 공유·저장, 친구 초대 (성공 지표용)
 *  결과 행 맨 끝 '소요시간(초)'는 시작 버튼부터 결과까지 걸린 시간 (성공 지표: 3분 이내)
 *
 * [내려주는 데이터 (GET ?action=model)] — 앱이 스스로 똑똑해지는 부분
 *  - "체크인" 시트 전체를 기질 유형 × 활동별로 집계: n(반응 수), done(수행), down(수행 후 스트레스 감소), rej(다른 추천 요청·맘에 안 듦)
 *  - 승인된 제안 활동 목록
 *  앱은 이 집계로 "실제로 해보고 스트레스가 줄었다는 기록이 많은 활동"을 더 자주 추천합니다.
 *  개인 단위 데이터는 내려주지 않고 집계 숫자만 내려줍니다. 결과는 5분간 캐시됩니다.
 *
 * 스크립트를 바꾼 뒤: SPREADSHEET_ID 입력 → setupTest 한 번 실행 → 배포 관리에서 "새 버전"으로 배포
 */

// ▼▼▼ 응답을 쌓을 구글 시트의 ID (v3·v4에서 넣은 값과 같은 ID) ▼▼▼
var SPREADSHEET_ID = "여기에_시트_ID";
// ▲▲▲

var CHECKIN_SHEET_NAME = "체크인";
var CONSENT_SHEET_NAME = "동의기록";
var SUGGEST_SHEET_NAME = "활동제안";
var EVENT_SHEET_NAME = "이벤트";

var RESULT_HEADER = ["시간", "ID", "이름(미사용)", "번아웃점수", "번아웃등급", "기질유형", "기질이름"];
for (var i = 1; i <= 16; i++) RESULT_HEADER.push("문항" + i);
RESULT_HEADER.push("동의시각");
RESULT_HEADER.push("소요시간(초)");

var CHECKIN_HEADER = [
  "시간", "익명ID", "체크인날짜", "회복일차",
  "활동ID", "활동내용", "계열", "강도(1~3)",
  "수행여부", "스트레스변화", "미수행이유", "다음추천",
  "현재번아웃등급", "강도상한", "기질유형", "동의시각", "주차(월요일)"
];
var CONSENT_HEADER = ["시간(서버)", "익명ID", "구분", "기기시각", "언어"];
var EVENT_HEADER = ["시간", "익명ID", "이벤트", "기질유형", "동의시각", "언어"];
var EVENT_NAMES = ["이미지 공유", "이미지 저장", "친구 초대"];
var SUGGEST_HEADER = [
  "시간", "익명ID", "제안자유형", "계열", "강도(1~3)", "제안내용",
  "승인(Y 입력 시 추천에 반영)", "대상유형(비우면 제안자 유형, ALL=전체)", "영문(선택)", "활동ID", "동의시각", "언어"
];

var FAM_KO = { move: "움직임", social: "연결", rest: "쉼" };
var FAM_KEY = { "움직임": "move", "연결": "social", "쉼": "rest" };
var STATUS_KO = { done: "수행", skip: "미수행", reject: "다른 추천 요청" };

function getSpreadsheet() {
  if (SPREADSHEET_ID && SPREADSHEET_ID.indexOf("여기에_") !== 0) return SpreadsheetApp.openById(SPREADSHEET_ID);
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) throw new Error("SPREADSHEET_ID를 설정하세요 (시트 주소의 /d/ 와 /edit 사이 문자열)");
  return active;
}

// 머리글 행이 없으면 만들고, 예전 머리글이면 새 머리글로 덮어씀.
// 1행이 머리글이 아닌 데이터라면 덮어쓰지 않고 맨 위에 머리글 행을 새로 끼워 넣음 (데이터 손실 방지)
function ensureHeader(sheet, header) {
  if (sheet.getLastRow() === 0) { sheet.appendRow(header); return; }
  var current = sheet.getRange(1, 1, 1, header.length).getValues()[0];
  if (current.join("|") === header.join("|")) return;
  if (String(current[0]) !== header[0]) sheet.insertRowBefore(1);
  sheet.getRange(1, 1, 1, header.length).setValues([header]);
}
function getOrCreate(ss, name) { return ss.getSheetByName(name) || ss.insertSheet(name); }

/** 스크립트를 바꾼 뒤 한 번 실행: 다섯 시트의 머리글을 맞추고 연결을 확인합니다. */
function setupTest() {
  var ss = getSpreadsheet();
  ensureHeader(ss.getSheets()[0], RESULT_HEADER);
  ensureHeader(getOrCreate(ss, CHECKIN_SHEET_NAME), CHECKIN_HEADER);
  ensureHeader(getOrCreate(ss, CONSENT_SHEET_NAME), CONSENT_HEADER);
  ensureHeader(getOrCreate(ss, SUGGEST_SHEET_NAME), SUGGEST_HEADER);
  ensureHeader(getOrCreate(ss, EVENT_SHEET_NAME), EVENT_HEADER);
  Logger.log("연결 성공: " + ss.getName());
  Logger.log("현재 모델 미리보기: " + JSON.stringify(buildModel()).slice(0, 500));
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  var resultSheet = null;
  try {
    var ss = getSpreadsheet();
    resultSheet = ss.getSheets()[0];
    var data = parsePayload(e);
    if (!data) {
      resultSheet.appendRow([new Date(), "ERROR", "요청에서 데이터를 찾지 못함"]);
      return json({ result: "error", message: "no payload" });
    }

    if (data.kind === "consent") {
      var cs = getOrCreate(ss, CONSENT_SHEET_NAME);
      ensureHeader(cs, CONSENT_HEADER);
      cs.appendRow([new Date(), data.uid || "", data.action || "", data.at || "", data.lang || ""]);
      return json({ result: "ok" });
    }

    if (data.kind === "event") {
      if (EVENT_NAMES.indexOf(data.event) < 0) return json({ result: "error", message: "unknown event" });
      var ev = getOrCreate(ss, EVENT_SHEET_NAME);
      ensureHeader(ev, EVENT_HEADER);
      ev.appendRow([new Date(), String(data.uid || "").slice(0, 40), data.event, String(data.typeKey || "").slice(0, 4),
                    String(data.consentAt || "").slice(0, 40), String(data.lang || "").slice(0, 4)]);
      return json({ result: "ok" });
    }

    if (data.kind === "suggest") {
      var sg = getOrCreate(ss, SUGGEST_SHEET_NAME);
      ensureHeader(sg, SUGGEST_HEADER);
      var text = String(data.text || "").slice(0, 120);
      var row = sg.getLastRow() + 1;
      sg.appendRow([
        new Date(), data.uid || "", data.typeKey || "", FAM_KO[data.fam] || data.fam || "",
        Math.max(1, Math.min(3, Number(data.intensity) || 1)), text,
        "", "", "", "u" + row, data.consentAt || "", data.lang || ""
      ]);
      return json({ result: "ok" });
    }

    if (data.kind === "checkin") {
      var sheet = getOrCreate(ss, CHECKIN_SHEET_NAME);
      ensureHeader(sheet, CHECKIN_HEADER);
      var status = data.status || (data.done ? "done" : "skip");
      sheet.appendRow([
        new Date(), data.uid, data.day, data.recoveryDay,
        data.activityId, data.activityText, data.fam, data.intensity,
        STATUS_KO[status] || status, data.effect || "", data.reason || "", data.next || "",
        data.level || "", data.cap || "", data.typeKey || "", data.consentAt || "", data.week || ""
      ]);
      CacheService.getScriptCache().remove("model"); // 새 기록이 들어오면 다음 요청 때 다시 집계
      return json({ result: "ok" });
    }

    // 결과(전체·주간 체크)
    ensureHeader(resultSheet, RESULT_HEADER);
    var answers = (data.answers || []).slice(0, 16);
    while (answers.length < 16) answers.push("");
    var duration = Number(data.durationSec);
    resultSheet.appendRow([new Date(), data.id, "", data.burnoutScore,
                           data.burnoutLevel, data.typeKey, data.typeName]
                          .concat(answers).concat([data.consentAt || "", duration > 0 && duration < 86400 ? duration : ""]));
    return json({ result: "ok" });

  } catch (err) {
    if (resultSheet) resultSheet.appendRow([new Date(), "ERROR", String(err), (e && e.postData ? e.postData.contents : "postData 없음")]);
    return json({ result: "error", message: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// ---- 추천 학습: 체크인 집계 + 승인된 제안 활동 ----
function buildModel() {
  var ss = getSpreadsheet();
  var stats = { EA: {}, ES: {}, IA: {}, IS: {} };
  var total = 0;

  var ck = ss.getSheetByName(CHECKIN_SHEET_NAME);
  if (ck && ck.getLastRow() > 1) {
    var rows = ck.getRange(2, 1, ck.getLastRow() - 1, CHECKIN_HEADER.length).getValues();
    rows.forEach(function (r) {
      var uid = String(r[1]), actId = String(r[4]), status = String(r[8]), effect = String(r[9]),
          reason = String(r[10]), type = String(r[14]);
      if (!actId || uid === "TEST" || actId === "TEST" || !stats[type]) return; // 테스트 행 제외
      var st = stats[type][actId] || (stats[type][actId] = { n: 0, done: 0, down: 0, rej: 0 });
      st.n++; total++;
      if (status === "수행") { st.done++; if (effect === "줄었음") st.down++; }
      else if (status === "다른 추천 요청" || reason === "맘에 안 듦") st.rej++;
    });
  }

  var activities = [];
  var sg = ss.getSheetByName(SUGGEST_SHEET_NAME);
  if (sg && sg.getLastRow() > 1) {
    var srows = sg.getRange(2, 1, sg.getLastRow() - 1, SUGGEST_HEADER.length).getValues();
    srows.forEach(function (r) {
      if (String(r[6]).trim().toUpperCase() !== "Y") return; // 운영자가 승인한 것만
      var fam = FAM_KEY[String(r[3])] || String(r[3]);
      if (["move", "social", "rest"].indexOf(fam) < 0 || !r[5]) return;
      var target = String(r[7] || r[2] || "").trim().toUpperCase();
      activities.push({
        id: String(r[9] || ("u" + r[0])), fam: fam, int: Math.max(1, Math.min(3, Number(r[4]) || 1)),
        ko: String(r[5]), en: String(r[8] || r[5]),
        types: target === "ALL" || !target ? [] : target.split(/[,\s]+/).filter(function (x) { return stats[x]; })
      });
    });
  }
  return { version: 2, updated: Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm"), total: total, stats: stats, activities: activities };
}

function doGet(e) {
  if (e && e.parameter && e.parameter.action === "model") {
    var cache = CacheService.getScriptCache();
    var cached = cache.get("model");
    if (cached) return ContentService.createTextOutput(cached).setMimeType(ContentService.MimeType.JSON);
    var out = JSON.stringify(buildModel());
    if (out.length < 90000) cache.put("model", out, 300);
    return ContentService.createTextOutput(out).setMimeType(ContentService.MimeType.JSON);
  }
  return ContentService.createTextOutput("이 URL은 POST 요청 전용입니다. HTML 앱에서 정상적으로 사용됩니다.");
}

// "payload=<JSON>" 폼 형식과 JSON 본문 형식을 모두 해석
function parsePayload(e) {
  if (!e) return null;
  if (e.parameter && e.parameter.payload) return JSON.parse(e.parameter.payload);
  if (e.postData && e.postData.contents) {
    var raw = e.postData.contents;
    if (raw.indexOf("payload=") === 0) return JSON.parse(decodeURIComponent(raw.slice(8).replace(/\+/g, " ")));
    return JSON.parse(raw);
  }
  return null;
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
