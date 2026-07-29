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

async function expandContent(keyword) {
  const prompt = `다음 키워드를 바탕으로 장애인 거주시설 사회복지 실습일지의 "실습내용" 항목을 작성해줘. 
키워드의 개수나 형식과 관계없이, 격식 있고 전문적인 문장으로 **정확히 5줄(5문장)**을 작성해줘. 
시간대(예: 09:00~)나 번호, 기호(- 등)는 절대로 붙이지 말고, 순수 문장만 줄바꿈으로 구분해서 5줄만 출력해.
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
키워드의 개수와 관계없이, 성찰적이고 전문적인 문장으로 **정확히 4줄(4문장)**을 작성해줘. 
번호, 기호(- 등)는 붙이지 말고 순수 문장만 줄바꿈으로 구분해서 4줄만 출력해.
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
  const defaultDept = "301호 (거주지원)";

  console.log("=== 사회복지 실습일지 자동 생성 프로그램 ===");
  console.log("(Ctrl+C 를 누르거나 '취소'라고 입력하면 언제든 문서를 만들지 않고 종료됩니다)\n");

  const date = await ask(`실습날짜 (예: ${defaultDate}, 엔터=오늘): `, defaultDate);
  checkCancel(date);

  const dept = await ask(`실습부서명 (예: ${defaultDept}, 엔터=기본값): `, defaultDept);
  checkCancel(dept);

  const contentKeyword = await ask("\n실습내용 키워드 입력: ", "");
  checkCancel(contentKeyword);
  console.log("실습내용 5줄 생성 중...");
  let { text: content } = await expandContent(contentKeyword);
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
  console.log(`부서명: ${dept}`);
  console.log(`실습내용:\n${content}`);
  console.log(`소감:\n${review}`);
  const finalConfirm = await ask("\n이대로 문서를 만들까요? (Enter=예, 취소=취소): ", "예");
  checkCancel(finalConfirm);

  rl.close();

  const episodeNo = getNextCount();

  const dateDigits = toDateDigits(date);
  const docTitle = dateDigits
    ? `실습일지_${episodeNo}회차_${dateDigits}`
    : `실습일지_${episodeNo}회차_${date.replace(/\s+/g, '_')}`;

  console.log(`\n새 문서 만드는 중... (제목: ${docTitle})`);
  const createdDoc = createDoc(docTitle);
  const documentId = createdDoc.documentId;

  console.log("표 생성 중...");
  runBatchUpdate(documentId, [
    { insertTable: { rows: 7, columns: 4, location: { index: 1 } } }
  ]);

  let body = getDoc(documentId);
  let tableEl = body.content.find(el => el.table);
  const tableStart = { index: tableEl.startIndex };

  console.log("셀 병합 중...");
  runBatchUpdate(documentId, [
    { mergeTableCells: { tableRange: { tableCellLocation: { tableStartLocation: tableStart, rowIndex: 0, columnIndex: 0 }, rowSpan: 1, columnSpan: 4 } } },
    { mergeTableCells: { tableRange: { tableCellLocation: { tableStartLocation: tableStart, rowIndex: 1, columnIndex: 1 }, rowSpan: 1, columnSpan: 3 } } },
    { mergeTableCells: { tableRange: { tableCellLocation: { tableStartLocation: tableStart, rowIndex: 2, columnIndex: 1 }, rowSpan: 1, columnSpan: 3 } } },
    { mergeTableCells: { tableRange: { tableCellLocation: { tableStartLocation: tableStart, rowIndex: 3, columnIndex: 1 }, rowSpan: 1, columnSpan: 3 } } },
    { mergeTableCells: { tableRange: { tableCellLocation: { tableStartLocation: tableStart, rowIndex: 4, columnIndex: 1 }, rowSpan: 1, columnSpan: 3 } } },
    { mergeTableCells: { tableRange: { tableCellLocation: { tableStartLocation: tableStart, rowIndex: 5, columnIndex: 1 }, rowSpan: 1, columnSpan: 3 } } }
  ]);

  body = getDoc(documentId);
  const table = body.content.find(el => el.table).table;
  const cellStart = (r, c) => safeCellStart(table, r, c);

  const header = "실 습 일 지";
  const rowsData = [
    [{ text: header, bold: true, center: true }],
    [{ text: "실습날짜", bold: true }, { text: date, bold: false }],
    [{ text: "실습부서명", bold: true }, { text: dept, bold: false }],
    [{ text: "실습 내용\n(과제)", bold: true }, { text: content, bold: false }],
    [{ text: "소감 및\n자기평가", bold: true }, { text: review, bold: false }],
    [{ text: "첨부자료", bold: true }, { text: " ", bold: false }],
    [
      { text: "실습생", bold: true },
      { text: "김호한 (서명 또는 인)", bold: false },
      { text: "실습지도자", bold: true },
      { text: "(서명 또는 인)", bold: false }
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
  items.forEach(({ idx, text, bold, center }) => {
    const validText = (text && text.length > 0) ? text : " ";
    fillRequests.push({ insertText: { location: { index: idx }, text: validText } });
    if (bold) {
      fillRequests.push({
        updateTextStyle: { range: { startIndex: idx, endIndex: idx + validText.length }, textStyle: { bold: true }, fields: "bold" }
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
  console.log(`🔗 링크: https://docs.google.com/document/d/${documentId}/edit`);
})();
