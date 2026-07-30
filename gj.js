const { execFileSync } = require('child_process');
const readline = require('readline');
const fs = require('fs');
const path = require('path');

// Ctrl+C를 누르면 언제든 안전하게 취소하고 종료
process.on('SIGINT', () => {
  console.log('\n\n🛑 취소되었습니다. 문서를 만들지 않고 종료합니다.');
  process.exit(0);
});

const COUNTER_FILE = path.join(__dirname, 'journal_counter.txt');
const HOURS_LOG_FILE = path.join(__dirname, 'practicum_hours.json');
const TOTAL_TARGET_HOURS = 160;

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

const ask = (q, defaultValue) => new Promise((resolve) => {
  rl.question(q, (answer) => {
    const trimmed = answer.trim();
    resolve(trimmed === '' ? defaultValue : trimmed);
  });
});

// "취소"라고 직접 입력해도 문서 생성 전에 안전하게 종료 (Ctrl+C의 보조 수단)
function checkCancel(input) {
  if (input.trim() === '취소') {
    console.log('\n🛑 취소되었습니다. 문서를 만들지 않고 종료합니다.');
    rl.close();
    process.exit(0);
  }
}

function runBatchUpdate(documentId, requestsArr) {
  const args = [
    'docs', 'documents', 'batchUpdate',
    '--params', JSON.stringify({ documentId }),
    '--json', JSON.stringify({ requests: requestsArr })
  ];
  return execFileSync('gws', args, { encoding: 'utf8' });
}

function getDoc(documentId) {
  const args = ['docs', 'documents', 'get', '--params', JSON.stringify({ documentId })];
  const raw = execFileSync('gws', args, { encoding: 'utf8' });
  const doc = JSON.parse(raw.slice(raw.indexOf('{')));
  return doc.body || (doc.tabs && doc.tabs[0].documentTab.body);
}

function createDoc(title) {
  const args = ['docs', 'documents', 'create', '--params', JSON.stringify({ title })];
  const raw = execFileSync('gws', args, { encoding: 'utf8' });
  return JSON.parse(raw.slice(raw.indexOf('{')));
}

function formatExactLines(text, targetCount, label) {
  if (!text) return { text: " ", shortBy: targetCount };
  let lines = text.split('\n')
    .map(l => l.trim().replace(/^[-*•\d.\s]+/, ''))
    .filter(l => l.length > 0);

  const shortBy = targetCount - lines.length;
  if (shortBy > 0) {
    console.log(`⚠️  [${label}] 목표 ${targetCount}줄인데 ${lines.length}줄만 생성됨. 아래 수정 단계에서 ${shortBy}줄을 직접 추가해주세요.`);
  }
  return { text: lines.slice(0, targetCount).join('\n'), shortBy: Math.max(shortBy, 0) };
}

function getNextCount() {
  let current = 14;
  if (fs.existsSync(COUNTER_FILE)) {
    current = parseInt(fs.readFileSync(COUNTER_FILE, 'utf8').trim(), 10) || 14;
  }
  const next = current + 1;
  fs.writeFileSync(COUNTER_FILE, String(next));
  return next;
}

// ===== 누계 실습시간 관리 =====
// practicum_hours.json에 { "20260627": 8, "20260703": 4, ... } 형태로 날짜별 시간을 저장.
// 같은 날짜(YYYYMMDD)가 이미 있으면 다시 더하지 않아서 중복 반영을 막음.
function loadHoursLog() {
  if (!fs.existsSync(HOURS_LOG_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(HOURS_LOG_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveHoursLog(log) {
  fs.writeFileSync(HOURS_LOG_FILE, JSON.stringify(log, null, 2));
}

function sumHours(log) {
  return Object.values(log).reduce((sum, h) => sum + h, 0);
}

// 아직 저장하지 않고 "이 날짜를 반영하면 누계가 얼마가 되는지"만 미리 계산 (취소 대비)
function previewCumulative(dateDigits, hours) {
  const log = loadHoursLog();
  const alreadyRecorded = dateDigits ? Object.prototype.hasOwnProperty.call(log, dateDigits) : false;
  const total = sumHours(log) + (alreadyRecorded ? 0 : hours);
  return { total, alreadyRecorded };
}

// 문서를 실제로 생성하기 직전에 호출해서 로그 파일에 확정 반영
function commitHours(dateDigits, hours) {
  const log = loadHoursLog();
  const alreadyRecorded = dateDigits ? Object.prototype.hasOwnProperty.call(log, dateDigits) : false;
  if (dateDigits && !alreadyRecorded) {
    log[dateDigits] = hours;
    saveHoursLog(log);
  }
  return { total: sumHours(log), alreadyRecorded };
}

function getTodayKorean() {
  const days = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
  const d = new Date();
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${days[d.getDay()]})`;
}

function toDateDigits(dateStr) {
  const m = dateStr.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (!m) return null;
  const [, y, mo, da] = m;
  return `${y}${mo.padStart(2, '0')}${da.padStart(2, '0')}`;
}

// 실습시간 1/2/3 선택 옵션
const TIME_OPTIONS = {
  '1': { time: '09시 00분 ~ 18시 00분', hours: '8시간', hoursNum: 8 },
  '2': { time: '09시 00분 ~ 14시 00분', hours: '4시간', hoursNum: 4 },
  '3': { time: '14시 00분 ~ 18시 00분', hours: '4시간', hoursNum: 4 }
};

const FALLBACK_CONTENT = "장애인 거주시설 이용인의 건강 증진과 쾌적한 거주 환경 조성을 목적으로 위생 청소 및 환경 정비를 실시하였습니다.\n이용인들의 주거 공간을 점검하고 먼지 제거와 환기를 진행하여 감염병 예방을 위한 청결을 유지하였습니다.\n자립 생활 능력 향상을 위해 이용인이 스스로 개인 공간을 청정하게 유지하도록 맞춤형 청소 활동을 지원하였습니다.\n공용 공간의 집기류를 소독하고 바닥의 이물질을 제거하여 안전한 시설 환경을 조성하였습니다.\n청소 및 위생 관리 과정을 통해 환경 정비가 이용인의 삶의 질 향상과 직결된다는 의미를 체득하였습니다.";
const FALLBACK_REVIEW = "환경 청결 유지가 주민 건강 및 쾌적한 일상생활과 직결된다는 점을 깊이 체감하였습니다.\n정기적인 위생 관리를 통해 감염 사고를 예방하고 주거 안정을 도모하는 실무 역량을 길렀습니다.\n주민 개별 특성에 부응하는 맞춤형 환경 케어 수순을 익히는 계기가 되었습니다.\n향후 주민의 존엄성과 안전을 보장하는 전문적 지원을 지속해서 실천하겠습니다.";

async function callGemini(prompt) {
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
  });
  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text;
}

async function expandContent(keyword, timeInfo) {
  const prompt = `다음은 장애인 거주시설 사회복지 실습일지의 "실습내용"을 쓰기 위한 키워드야. 키워드는 쉼표(,)로 여러 개 나열되어 있을 수 있어.
이 실습은 ${timeInfo.time} 동안 진행됐어. 문장에 시간대를 직접 언급할 필요는 없지만, 혹시라도 "아침", "오전", "오후", "점심", "저녁" 같은 시간대를 암시하는 표현을 쓰게 된다면 반드시 이 실습시간과 앞뒤가 맞아야 해. 예를 들어 14시~18시 실습인데 "아침"이라고 쓰면 안 돼.

이 키워드들을 바탕으로, 실습생이 그날 현장에서 실제로 겪은 구체적인 일을 쓰듯이 **정확히 5줄(5문장)**을 작성해줘.

문체 참고 (실제 현장실습일지에서 뽑은 특징):
- "301호 남자 중증장애인 생활실에 배정받아 주민 8명의 특성을 파악하고 첫인사를 나눔", "화장실 변기 물을 지속해서 방류하는 반복 행동을 인지하고 즉각적인 행동 제지를 함"처럼, 그날 있었던 구체적인 행동이나 상황을 그대로 서술하는 방식으로 써줘.
- 키워드에 있는 숫자, 인원, 장소, 대상 등 구체적인 정보는 절대 누락하지 말고 문장에 그대로 살려줘.
- 문장 끝맺음을 "~하였습니다"로만 반복하지 말고 "~함", "~보조함", "~실시함", "~파악함"처럼 다양하게 섞어 써줘. 문장 구조도 매번 비슷하게 반복되지 않게 해줘.
- '행동 특성과 요구사항을 정밀하게 모니터링하였습니다', '정서적 교감을 도모하였습니다' 같은 추상적이고 딱딱한 표현은 쓰지 마.
- 키워드에 없는 내용을 지나치게 부풀리거나 일반화하지 마.
- 번호나 기호(- 등)는 쓰지 말고, 순수 문장만 줄바꿈으로 구분해서 5줄만 출력해.

키워드: ${keyword}`;
  try {
    const rawText = await callGemini(prompt);
    if (!rawText) {
      console.log("⚠️  [실습내용] Gemini 응답 없음 → 예시 문구로 대체됨. 반드시 직접 수정해주세요.");
      return { text: FALLBACK_CONTENT, isFallback: true };
    }
    const { text } = formatExactLines(rawText.trim(), 5, '실습내용');
    return { text, isFallback: false };
  } catch (err) {
    console.log(`⚠️  [실습내용] API 호출 실패 (${err.message}) → 예시 문구로 대체됨. 반드시 직접 수정해주세요.`);
    return { text: FALLBACK_CONTENT, isFallback: true };
  }
}

async function expandReview(keyword) {
  const prompt = `다음 키워드를 바탕으로 사회복지 실습일지의 "소감 및 자기평가" 항목을 작성해줘.
키워드의 개수와 관계없이, **정확히 4줄(4문장)**을 작성해줘.

문체 참고 (실제 현장실습일지에서 뽑은 특징):
- 그날 있었던 구체적인 상황에서 바로 이어지는 성찰을 써줘. "정기적인 위생 관리를 통해 감염 사고를 예방하고 주거 안정을 도모하는 실무 역량을 길렀습니다" 같은 뜬구름 잡는 일반론보다, 그 상황을 통해 구체적으로 무엇을 느꼈고 무엇을 배웠는지 써줘.
- 문장 끝맺음을 "~하였습니다"로만 반복하지 말고 다양하게 섞어 써줘.
- '전문성', '역량', '지원 체계' 같은 상투적인 단어를 남발하지 마.
- 번호나 기호(- 등)는 쓰지 말고 순수 문장만 줄바꿈으로 구분해서 4줄만 출력해.

키워드: ${keyword}`;
  try {
    const rawText = await callGemini(prompt);
    if (!rawText) {
      console.log("⚠️  [소감] Gemini 응답 없음 → 예시 문구로 대체됨. 반드시 직접 수정해주세요.");
      return { text: FALLBACK_REVIEW, isFallback: true };
    }
    const { text } = formatExactLines(rawText.trim(), 4, '소감');
    return { text, isFallback: false };
  } catch (err) {
    console.log(`⚠️  [소감] API 호출 실패 (${err.message}) → 예시 문구로 대체됨. 반드시 직접 수정해주세요.`);
    return { text: FALLBACK_REVIEW, isFallback: true };
  }
}

function safeCellStart(table, r, c) {
  const row = table.tableRows[r];
  if (!row) throw new Error(`표에 ${r}번 행이 없습니다. 표 구조를 확인하세요.`);
  const cell = row.tableCells[c];
  if (!cell) throw new Error(`(${r}, ${c}) 셀을 찾을 수 없습니다. 병합 결과가 예상과 다를 수 있습니다.`);
  return cell.content[0].startIndex;
}

(async () => {
  const defaultDate = getTodayKorean();
  const defaultDept = "애명다온빌 생활관";

  console.log("=== 사회복지 실습일지 자동 생성 프로그램 ===");
  console.log("(Ctrl+C 를 누르거나 '취소'라고 입력하면 언제든 문서를 만들지 않고 종료됩니다)\n");

  const date = await ask(`실습날짜 (예: ${defaultDate}, 엔터=오늘): `, defaultDate);
  checkCancel(date);

  console.log("\n실습시간 선택");
  console.log("  1) 09시 00분 ~ 18시 00분 (8시간)");
  console.log("  2) 09시 00분 ~ 14시 00분 (4시간)");
  console.log("  3) 14시 00분 ~ 18시 00분 (4시간)");
  const timeChoice = await ask("번호 선택 (엔터=1): ", "1");
  checkCancel(timeChoice);
  const timeInfo = TIME_OPTIONS[timeChoice.trim()] || TIME_OPTIONS['1'];

  // 날짜 기준으로 누계 실습시간 미리 계산해서 보여줌 (아직 파일에 저장은 안 함)
  const dateDigitsForLog = toDateDigits(date);
  const preview = previewCumulative(dateDigitsForLog, timeInfo.hoursNum);
  console.log(`\n📊 예상 누계 실습시간: ${preview.total}시간 / ${TOTAL_TARGET_HOURS}시간${preview.alreadyRecorded ? '  (이 날짜는 이미 기록되어 있어 중복 반영되지 않습니다)' : ''}`);

  const dept = await ask(`\n실습부서명 (예: ${defaultDept}, 엔터=기본값): `, defaultDept);
  checkCancel(dept);

  const contentKeyword = await ask("\n실습내용 키워드 입력 (여러 개면 쉼표(,)로 구분): ", "");
  checkCancel(contentKeyword);
  console.log("실습내용 5줄 생성 중...");
  let { text: content } = await expandContent(contentKeyword, timeInfo);
  console.log(`\n[생성된 실습내용 (5줄)]\n${content}\n`);
  const editContent = await ask("이대로 쓸까요? 수정하려면 직접 입력, 그대로면 Enter: ", "");
  checkCancel(editContent);
  if (editContent.trim() !== "") content = formatExactLines(editContent, 5, '실습내용(수동)').text;

  const reviewKeyword = await ask("\n소감/자기평가 키워드 입력: ", "");
  checkCancel(reviewKeyword);
  console.log("소감 4줄 생성 중...");
  let { text: review } = await expandReview(reviewKeyword);
  console.log(`\n[생성된 소감 및 자기평가 (4줄)]\n${review}\n`);
  const editReview = await ask("이대로 쓸까요? 수정하려면 직접 입력, 그대로면 Enter: ", "");
  checkCancel(editReview);
  if (editReview.trim() !== "") review = formatExactLines(editReview, 4, '소감(수동)').text;

  console.log("\n=== 최종 확인 ===");
  console.log(`날짜: ${date}`);
  console.log(`시간: ${timeInfo.time} (${timeInfo.hours})`);
  console.log(`부서명: ${dept}`);
  console.log(`실습내용:\n${content}`);
  console.log(`소감:\n${review}`);
  console.log(`누계 실습시간: ${preview.total}시간 / ${TOTAL_TARGET_HOURS}시간`);
  const finalConfirm = await ask("\n이대로 문서를 만들까요? (Enter=예, 취소=취소): ", "예");
  checkCancel(finalConfirm);

  rl.close();

  const episodeNo = getNextCount();

  const dateDigits = toDateDigits(date);
  // 여기서 실제로 누계 실습시간 로그 파일에 확정 반영 (취소된 경우엔 여기까지 오지 않으므로 기록되지 않음)
  const { total: cumulativeHours } = commitHours(dateDigits, timeInfo.hoursNum);
  const progressPercent = Math.round((cumulativeHours / TOTAL_TARGET_HOURS) * 1000) / 10;
  const attachmentText = `누계 실습시간: ${cumulativeHours}시간 / ${TOTAL_TARGET_HOURS}시간 (진행률 ${progressPercent}%)`;

  const docTitle = dateDigits
    ? `실습일지_${episodeNo}회차_${dateDigits}`
    : `실습일지_${episodeNo}회차_${date.replace(/\s+/g, '_')}`;

  console.log(`\n새 문서 만드는 중... (제목: ${docTitle})`);
  const createdDoc = createDoc(docTitle);
  const documentId = createdDoc.documentId;

  // A4 용지 크기 명시 설정 (595.3pt x 841.9pt = A4)
  console.log("용지 크기(A4) 설정 중...");
  runBatchUpdate(documentId, [
    {
      updateDocumentStyle: {
        documentStyle: {
          pageSize: { width: { magnitude: 595.3, unit: 'PT' }, height: { magnitude: 841.9, unit: 'PT' } }
        },
        fields: 'pageSize'
      }
    }
  ]);

  console.log("표 생성 중...");
  runBatchUpdate(documentId, [
    { insertTable: { rows: 7, columns: 5, location: { index: 1 } } }
  ]);

  let body = getDoc(documentId);
  let tableEl = body.content.find(el => el.table);
  const tableStart = { index: tableEl.startIndex };

  console.log("셀 병합 중...");
  runBatchUpdate(documentId, [
    { mergeTableCells: { tableRange: { tableCellLocation: { tableStartLocation: tableStart, rowIndex: 0, columnIndex: 0 }, rowSpan: 1, columnSpan: 5 } } },
    { mergeTableCells: { tableRange: { tableCellLocation: { tableStartLocation: tableStart, rowIndex: 1, columnIndex: 1 }, rowSpan: 1, columnSpan: 4 } } },
    // 2행(실습시간/시수/실습부서명)은 5칸 그대로, 병합하지 않음
    { mergeTableCells: { tableRange: { tableCellLocation: { tableStartLocation: tableStart, rowIndex: 3, columnIndex: 1 }, rowSpan: 1, columnSpan: 4 } } },
    { mergeTableCells: { tableRange: { tableCellLocation: { tableStartLocation: tableStart, rowIndex: 4, columnIndex: 1 }, rowSpan: 1, columnSpan: 4 } } },
    { mergeTableCells: { tableRange: { tableCellLocation: { tableStartLocation: tableStart, rowIndex: 5, columnIndex: 1 }, rowSpan: 1, columnSpan: 4 } } },
    // 실습지도자 + 서명란은 나누지 않고 하나로 병합
    { mergeTableCells: { tableRange: { tableCellLocation: { tableStartLocation: tableStart, rowIndex: 6, columnIndex: 2 }, rowSpan: 1, columnSpan: 3 } } }
  ]);

  // 열 너비를 5개 열 전체 명시적으로 지정
  // (0:라벨 / 1:시간·이름 값 / 2:시수 / 3:부서명 라벨 / 4:부서명 값)
  // 1열을 넉넉히 잡아서 "09시 00분 ~ 18시 00분"이나 "김호한 (서명 또는 인)"이 한 줄에 들어가게 함
  console.log("열 너비 조정 중...");
  const COLUMN_WIDTHS = [60, 150, 60, 65, 115]; // 합계 약 450pt (A4 본문 폭 기준)
  runBatchUpdate(
    documentId,
    COLUMN_WIDTHS.map((w, i) => ({
      updateTableColumnProperties: {
        tableStartLocation: tableStart,
        columnIndices: [i],
        tableColumnProperties: { widthType: 'FIXED_WIDTH', width: { magnitude: w, unit: 'PT' } },
        fields: '*'
      }
    }))
  );

  // 실습내용/소감 행 높이 늘리기 (A4 양식 참고 - 여백 있는 형태)
  console.log("행 높이 조정 중...");
  runBatchUpdate(documentId, [
    {
      updateTableRowStyle: {
        tableStartLocation: tableStart,
        rowIndices: [3],
        tableRowStyle: { minRowHeight: { magnitude: 140, unit: 'PT' } },
        fields: 'minRowHeight'
      }
    },
    {
      updateTableRowStyle: {
        tableStartLocation: tableStart,
        rowIndices: [4],
        tableRowStyle: { minRowHeight: { magnitude: 100, unit: 'PT' } },
        fields: 'minRowHeight'
      }
    }
  ]);

  body = getDoc(documentId);
  const table = body.content.find(el => el.table).table;
  const cellStart = (r, c) => safeCellStart(table, r, c);

  const header = "실 습 일 지";
  const rowsData = [
    [{ text: header, bold: true, center: true, fontSize: 22 }],
    [{ text: "실습날짜", bold: true }, { text: date, bold: false }],
    [
      { text: "실습시간", bold: true },
      { text: timeInfo.time, bold: false },
      { text: timeInfo.hours, bold: false },
      { text: "실습부서명", bold: true },
      { text: dept, bold: false }
    ],
    [{ text: "실습 내용\n(과제)", bold: true }, { text: content, bold: false }],
    [{ text: "소감 및\n자기평가", bold: true }, { text: review, bold: false }],
    [{ text: "첨부자료", bold: true }, { text: attachmentText, bold: false }],
    [
      { text: "실습생", bold: true },
      { text: "김호한 (서명 또는 인)", bold: false },
      { text: "실습지도자                    (서명 또는 인)", bold: false }
    ]
  ];

  const items = [];
  rowsData.forEach((cells, r) => {
    cells.forEach((cellInfo, c) => {
      items.push({ idx: cellStart(r, c), ...cellInfo });
    });
  });
  items.sort((a, b) => b.idx - a.idx);

  const fillRequests = [];
  items.forEach(({ idx, text, bold, center, fontSize }) => {
    const validText = (text && text.length > 0) ? text : " ";
    fillRequests.push({ insertText: { location: { index: idx }, text: validText } });
    if (bold) {
      fillRequests.push({
        updateTextStyle: { range: { startIndex: idx, endIndex: idx + validText.length }, textStyle: { bold: true }, fields: "bold" }
      });
    }
    if (fontSize) {
      fillRequests.push({
        updateTextStyle: { range: { startIndex: idx, endIndex: idx + validText.length }, textStyle: { fontSize: { magnitude: fontSize, unit: 'PT' } }, fields: "fontSize" }
      });
    }
    if (center) {
      fillRequests.push({
        updateParagraphStyle: { range: { startIndex: idx, endIndex: idx + validText.length }, paragraphStyle: { alignment: "CENTER" }, fields: "alignment" }
      });
    }
  });

  console.log("내용 채우는 중...");
  runBatchUpdate(documentId, fillRequests);

  console.log(`\n✅ 완료! 저장 제목: ${docTitle}`);
  console.log(`📊 ${attachmentText}`);
  console.log(`🔗 링크: https://docs.google.com/document/d/${documentId}/edit`);
})();
