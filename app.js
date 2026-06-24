const initial = window.RAINFALL_FREQUENCY_DATA || {};
const IS_LOCAL_API_HOST = ["127.0.0.1:8765", "localhost:8765"].includes(location.host);
const DEFAULT_PUBLIC_API_BASE = atob("aHR0cHM6Ly9xbWN4d3FsY3F6ZWFzdXpsaWpyai5mdW5jdGlvbnMuc3VwYWJhc2UuY28vZmxvb2RhbA==");
const API_BASE = IS_LOCAL_API_HOST
  ? ""
  : String(window.FLOODAL_API_BASE || localStorage.getItem("FLOODAL_API_BASE") || DEFAULT_PUBLIC_API_BASE).replace(/\/+$/, "");

const DURATION_LABELS = {
  60: "1H",
  120: "2H",
  180: "3H",
  360: "6H",
  540: "9H",
  720: "12H",
  1440: "24H",
  2880: "48H"
};
const COLORS = ["#2563eb", "#0891b2", "#0f766e", "#7c3aed", "#eab308", "#f97316", "#dc2626", "#475569", "#9333ea", "#0ea5e9"];
const RESULT_DOWNLOAD_COLUMNS = [
  ["station_name", "관측소"],
  ["station_id", "관측소 코드"],
  ["design_station_code", "기준 지점코드"],
  ["region", "지역/기준 코드"],
  ["observation_source", "자료 제공 기관"],
  ["duration_min", "지속시간(분)"],
  ["duration_label", "지속시간"],
  ["max_rainfall_mm", "최대강우량(mm)"],
  ["intensity_mm_per_hr", "강우강도(mm/hr)"],
  ["start_time", "발생 시작시각"],
  ["end_time", "발생 종료시각"],
  ["design_rainfall_mm", "기준 확률강우량(mm)"],
  ["estimated_return_period_label", "재현기간"],
  ["estimated_return_period_year", "재현기간(년)"],
  ["frequency_band", "빈도구간"],
  ["lower_return_period_year", "하한 재현기간(년)"],
  ["lower_rainfall_mm", "하한 확률강우량(mm)"],
  ["upper_return_period_year", "상한 재현기간(년)"],
  ["upper_rainfall_mm", "상한 확률강우량(mm)"]
];

const state = {
  stations: [],
  designStations: [],
  designRows: [],
  staticCatalog: null,
  staticDesignRainfall: null,
  results: initial.results || [],
  rawRecords: [],
  idfMode: "rainfall",
  selectedDurations: new Set((initial.durations_min || [60, 120, 180, 360, 540, 720, 1440, 2880]).map(Number)),
  lastAnalysis: null
};

const $ = (selector) => document.querySelector(selector);

const els = {
  analysisMode: $("#analysisModeSelect"),
  basin: $("#basinSelect"),
  stationSearch: $("#stationSearchInput"),
  stationSelect: $("#stationSelect"),
  designSelect: $("#designStationSelect"),
  stationId: $("#stationIdInput"),
  start: $("#startInput"),
  end: $("#endInput"),
  durationButtons: $("#durationButtons"),
  runButton: $("#runButton"),
  rawButton: $("#rawDownloadButton"),
  refreshButton: $("#refreshButton"),
  downloadButtons: document.querySelectorAll("[data-download-format]"),
  status: $("#statusText"),
  progressWrap: $("#progressWrap"),
  progressFill: $("#progressFill"),
  progressLabel: $("#progressLabel"),
  peak1h: $("#peak1hValue"),
  totalRainfall: $("#totalRainfallValue"),
  maxFrequency: $("#maxFrequencyValue"),
  peakDuration: $("#peakDurationValue"),
  analysisPeriod: $("#analysisPeriodValue"),
  dbSource: $("#dbSourceValue"),
  dbVerify: $("#dbVerifyValue"),
  maxFrequencyCard: $("#maxFrequencyCard"),
  barChart: $("#barChart"),
  idfChart: $("#idfChart"),
  rows: $("#resultRows")
};

function number(value, digits = 1) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return value || "-";
  return new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0
  }).format(numeric);
}

function toDateTimeLocal(value) {
  return value ? String(value).replace(" ", "T").slice(0, 16) : "";
}

function fromDateTimeLocal(value) {
  return String(value || "").replace("T", " ");
}

function durationLabel(minutes) {
  const min = Number(minutes);
  if (DURATION_LABELS[min]) return DURATION_LABELS[min];
  if (min < 60) return `${min}분`;
  return `${min / 60}H`;
}

function durationKorean(minutes) {
  const min = Number(minutes);
  if (min < 60) return `${min}분`;
  if (min % 60 === 0) return `${min / 60}시간`;
  return `${min}분`;
}

function parseYear(label, fallback) {
  const direct = Number(fallback);
  if (Number.isFinite(direct)) return direct;
  const match = String(label || "").match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function severityClass(yearOrLabel, fallback) {
  const year = parseYear(yearOrLabel, fallback);
  if (year >= 100) return "danger pulse-warning";
  if (year >= 50) return "warning";
  return "";
}

function selectedOptionData(select) {
  return select.selectedOptions[0]?.dataset || {};
}

function normalizeStation(row) {
  return {
    station_id: String(row.station_id || row.station_code || ""),
    station_code: String(row.station_code || row.station_id || ""),
    station_name: String(row.station_name || row.station_code || row.station_id || ""),
    region: String(row.region || ""),
    source: String(row.source || ""),
    agency: String(row.agency || agencyFromRegion(row.region || "")),
    basin: String(row.basin || basinFromRegion(row.region || "")),
    hrfco_available: row.hrfco_available
  };
}

function basinFromRegion(region) {
  return String(region || "").split("/").map((part) => part.trim()).filter(Boolean)[0] || "";
}

function agencyFromRegion(region) {
  return String(region || "").split("/").map((part) => part.trim()).filter(Boolean)[1] || "";
}

function initializeInputs() {
  els.stationId.value = initial.station_id || "";
  els.start.value = toDateTimeLocal(initial.start_time || "2026-06-01 00:00");
  els.end.value = toDateTimeLocal(initial.end_time || "2026-06-10 00:00");
  renderDurationButtons();
}

function renderDurationButtons() {
  const durations = [60, 120, 180, 360, 540, 720, 1440, 2880];
  els.durationButtons.innerHTML = durations.map((duration) => `
    <button class="duration-button ${state.selectedDurations.has(duration) ? "active" : ""}" data-duration="${duration}" type="button">
      ${durationLabel(duration)}
    </button>
  `).join("");
}

async function loadInitialData() {
  setProgress(12, "DB 검증 중");
  await verifyDb();
  setProgress(35, "기준 지점 조회 중");
  await loadDesignStations();
  setProgress(62, "관측소 조회 중");
  await loadObservationStations();
  populateSelects();
  setProgress(100, "준비 완료");
  setTimeout(() => setProgress(null), 400);
  els.status.textContent = "관측소와 기간을 선택한 뒤 분석을 실행하세요.";
  await loadDesignRows();
  renderAll();
}

async function verifyDb() {
  try {
    const data = await fetchJson("/api/db/verify");
    const summary = data.summary || {};
    els.dbVerify.textContent = `행 수 ${number(summary.row_count || 0, 0)}건 검증`;
  } catch (error) {
    els.dbVerify.textContent = !IS_LOCAL_API_HOST && !API_BASE ? "실시간 API 필요" : "DB 검증 실패";
    els.status.textContent = !IS_LOCAL_API_HOST && !API_BASE
      ? "관측소와 기준표는 로드됐지만, 분석은 실시간 API가 연결되어야 실행됩니다."
      : error.message;
  }
}

async function loadDesignStations() {
  try {
    const data = await fetchJson("/api/design-rainfall/stations");
    state.designStations = (data.stations || []).map(normalizeStation);
  } catch (error) {
    const catalog = await loadStaticCatalog();
    state.designStations = (catalog.design_stations || []).map(normalizeStation);
    if (!state.designStations.length) {
      throw error;
    }
  }
}

async function loadObservationStations() {
  try {
    const data = await fetchJson("/api/stations");
    const rows = Array.isArray(data) ? data : (data.stations || []);
    state.stations = rows.map(normalizeStation);
  } catch (error) {
    state.stations = [];
    els.status.textContent = `관측소 목록 조회 실패: ${error.message}`;
  }
  if (!state.stations.length) {
    try {
      const catalog = await loadStaticCatalog();
      state.stations = (catalog.stations || []).map(normalizeStation);
    } catch (error) {
      els.status.textContent = `정적 관측소 목록 조회 실패: ${error.message}`;
    }
  }
  if (!state.stations.length) {
    state.stations = state.designStations.slice();
  }
}

async function loadStaticCatalog() {
  if (state.staticCatalog) return state.staticCatalog;
  const response = await fetch(staticDataUrl("data/catalog.json"));
  if (!response.ok) {
    throw new Error("정적 관측소 목록을 불러올 수 없습니다.");
  }
  state.staticCatalog = await response.json();
  return state.staticCatalog;
}

async function loadStaticDesignRows(stationCode) {
  if (!state.staticDesignRainfall) {
    const response = await fetch(staticDataUrl("data/design-rainfall.json"));
    if (!response.ok) {
      throw new Error("정적 확률강우량을 불러올 수 없습니다.");
    }
    state.staticDesignRainfall = await response.json();
  }
  const code = String(stationCode || "");
  const rows = (state.staticDesignRainfall.rows_by_station || {})[code] || [];
  return rows.map(([durationMin, returnPeriodYear, rainfallMm]) => ({
    station_code: code,
    duration_min: Number(durationMin),
    duration_label: durationLabelKo(durationMin),
    return_period_year: Number(returnPeriodYear),
    rainfall_mm: Number(rainfallMm)
  }));
}

function staticDataUrl(path, version = "realtime1") {
  return `${path}?v=${encodeURIComponent(version)}`;
}

function durationLabelKo(durationMin) {
  return {
    60: "1시간",
    120: "2시간",
    180: "3시간",
    360: "6시간",
    540: "9시간",
    720: "12시간",
    1440: "24시간",
    2880: "48시간"
  }[Number(durationMin)] || `${durationMin}분`;
}

function populateSelects() {
  populateBasinSelect();
  populateStationSelect();
  populateDesignSelect();
  if (els.stationId.value) {
    els.stationSelect.value = els.stationId.value;
    els.designSelect.value = els.stationId.value;
  }
  syncStationFields();
  updateAnalysisMode();
}

function populateBasinSelect() {
  const current = els.basin.value;
  const basins = [...new Set(state.stations.map((station) => station.basin).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "ko-KR"));
  els.basin.innerHTML = `<option value="">중권역 선택</option>` + basins.map((basin) => {
    const count = availableBasinStations(basin).length;
    return `<option value="${escapeHtml(basin)}">${escapeHtml(basin)} (${number(count, 0)}개)</option>`;
  }).join("");
  if (basins.includes(current)) {
    els.basin.value = current;
  }
}

function availableBasinStations(basin) {
  const designCodes = new Set(state.designStations.map((station) => station.station_id));
  return state.stations.filter((station) => station.basin === basin && designCodes.has(station.station_id));
}

function populateStationSelect() {
  const query = els.stationSearch.value.trim().toLowerCase();
  const basin = els.basin.value;
  const rows = state.stations
    .filter((station) => !basin || station.basin === basin)
    .filter((station) => {
      if (!query) return true;
      return `${station.station_name} ${station.station_id} ${station.region} ${station.agency} ${station.basin}`.toLowerCase().includes(query);
    })
    .slice(0, 900);
  els.stationSelect.innerHTML = rows.map(optionHtml).join("");
  if (!rows.length) {
    els.stationSelect.innerHTML = `<option value="">검색 결과 없음</option>`;
  }
}

function populateDesignSelect() {
  els.designSelect.innerHTML = state.designStations.map(optionHtml).join("");
  if (!state.designStations.length) {
    els.designSelect.innerHTML = `<option value="">DB 기준 지점 없음</option>`;
  }
}

function optionHtml(station) {
  const code = escapeHtml(station.station_id || station.station_code);
  const name = escapeHtml(station.station_name || code);
  const agency = escapeHtml(station.agency || station.source || "");
  const basin = escapeHtml(station.basin || "");
  const region = [basin, agency].filter(Boolean).join(" / ");
  return `<option value="${code}" data-name="${name}" data-agency="${agency}" data-basin="${basin}">${name} (${code})${region ? ` ${region}` : ""}</option>`;
}

function syncStationFields() {
  if (isBasinMode()) {
    selectFirstDesignForBasin();
    return;
  }
  const stationId = els.stationSelect.value || els.stationId.value;
  els.stationId.value = stationId;
  if ([...els.designSelect.options].some((option) => option.value === stationId)) {
    els.designSelect.value = stationId;
  }
}

function isBasinMode() {
  return els.analysisMode.value === "basin";
}

function updateAnalysisMode() {
  const basinMode = isBasinMode();
  els.stationSearch.disabled = false;
  els.stationSelect.disabled = basinMode;
  els.stationId.disabled = basinMode;
  els.designSelect.disabled = basinMode;
  els.rawButton.disabled = basinMode;
  $(".button-text").textContent = basinMode ? "중권역 전체 분석" : "분석 실행";
  if (basinMode) {
    els.stationId.value = "";
    selectFirstDesignForBasin();
    const basin = els.basin.value;
    const count = basin ? availableBasinStations(basin).length : 0;
    els.status.textContent = basin
      ? `${basin} 중권역 ${number(count, 0)}개 관측소를 한 번에 분석할 수 있습니다.`
      : "중권역을 선택하면 해당 중권역 관측소를 한 번에 분석합니다.";
  } else {
    syncStationFields();
  }
}

function selectFirstDesignForBasin() {
  const basin = els.basin.value;
  const first = basin ? availableBasinStations(basin)[0] : null;
  if (first && [...els.designSelect.options].some((option) => option.value === first.station_id)) {
    els.designSelect.value = first.station_id;
  }
}

async function loadDesignRows() {
  const code = els.designSelect.value || els.stationId.value || initial.region;
  if (!code) return;
  try {
    const data = await fetchJson(`/api/design-rainfall/${encodeURIComponent(code)}`);
    state.designRows = data.rows || [];
    if (isBasinMode()) {
      updateAnalysisMode();
    } else {
      els.status.textContent = `기준 지점 ${code} 확률강우량 ${state.designRows.length}건을 불러왔습니다.`;
    }
    renderIdf();
  } catch (error) {
    const staticRows = await loadStaticDesignRows(code).catch(() => []);
    if (staticRows.length) {
      state.designRows = staticRows;
      if (isBasinMode()) {
        updateAnalysisMode();
      } else {
        els.status.textContent = `기준 지점 ${code} 확률강우량 ${state.designRows.length}건을 불러왔습니다.`;
      }
      renderIdf();
      return;
    }
    state.designRows = [];
    els.status.textContent = error.message;
    renderIdf();
  }
}

async function runAnalysis() {
  const durations = [...state.selectedDurations].sort((a, b) => a - b);
  if (isBasinMode()) {
    await runBasinAnalysis(durations);
    return;
  }
  if (!els.stationId.value || !els.designSelect.value) {
    els.status.textContent = "관측소와 기준 지점코드를 먼저 선택하세요.";
    return;
  }
  if (!durations.length) {
    els.status.textContent = "지속시간을 하나 이상 선택하세요.";
    return;
  }
  const body = {
    station_id: els.stationId.value.trim(),
    station_name: selectedOptionData(els.stationSelect).name || els.stationId.value.trim(),
    design_station_code: els.designSelect.value,
    region: els.designSelect.value,
    start_time: fromDateTimeLocal(els.start.value),
    end_time: fromDateTimeLocal(els.end.value),
    durations_min: durations
  };

  beginLoading("HRFCO 10분 원자료를 가져와 이동합을 계산하는 중입니다.");
  try {
    ensureRealtimeApi();
    const data = await fetchJson("/api/rainfall/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    state.results = data.results || [];
    state.rawRecords = data.raw_records || [];
    state.designRows = data.design_rows || [];
    state.lastAnalysis = data;
    els.status.textContent = `분석 완료: 원자료 ${number(data.raw_record_count || 0, 0)}건, 결과 ${state.results.length}건.`;
    renderAll();
  } catch (error) {
    els.status.textContent = error.message;
  } finally {
    endLoading();
  }
}

async function runBasinAnalysis(durations) {
  const basin = els.basin.value;
  if (!basin) {
    els.status.textContent = "중권역 전체 분석을 하려면 중권역을 먼저 선택하세요.";
    return;
  }
  if (!durations.length) {
    els.status.textContent = "지속시간을 하나 이상 선택하세요.";
    return;
  }
  const targetStations = availableBasinStations(basin);
  const targetCount = targetStations.length;
  if (!targetCount) {
    els.status.textContent = `${basin} 중권역에 분석 가능한 관측소가 없습니다.`;
    return;
  }
  beginLoading(`${basin} 중권역 ${number(targetCount, 0)}개 관측소 분석 작업을 시작합니다.`);
  try {
    ensureRealtimeApi();
    if (API_BASE) {
      await runPublicBasinAnalysis(basin, durations, targetStations);
      return;
    }
    const startData = await fetchJson("/api/rainfall/analyze/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        analysis_scope: "basin",
        middle_basin: basin,
        start_time: fromDateTimeLocal(els.start.value),
        end_time: fromDateTimeLocal(els.end.value),
        durations_min: durations
      })
    });
    await pollAnalysisJob(startData.job_id);
  } catch (error) {
    els.status.textContent = error.message;
  } finally {
    endLoading();
  }
}

function canUseServerApi() {
  return IS_LOCAL_API_HOST || Boolean(API_BASE);
}

function ensureRealtimeApi() {
  if (canUseServerApi()) return;
  throw new Error("실시간 분석 API가 연결되어 있지 않습니다. GitHub Pages 단독으로는 HRFCO 키를 숨긴 실시간 분석을 실행할 수 없습니다.");
}

async function runPublicBasinAnalysis(basin, durations, targetStations) {
  const resultsByIndex = Array(targetStations.length).fill(null);
  const errors = [];
  let nextIndex = 0;
  let completed = 0;
  let rawRecordCount = 0;
  let totalRainfallMm = 0;
  const workerCount = Math.min(8, targetStations.length);
  const resultCount = () => resultsByIndex.reduce((total, rows) => total + (Array.isArray(rows) ? rows.length : 0), 0);

  async function analyzeNext() {
    while (nextIndex < targetStations.length) {
      const targetIndex = nextIndex;
      nextIndex += 1;
      const station = targetStations[targetIndex];
      try {
        const data = await fetchJson("/api/rainfall/analyze", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            station_id: station.station_id,
            station_name: station.station_name,
            design_station_code: station.station_id,
            region: station.station_id,
            start_time: fromDateTimeLocal(els.start.value),
            end_time: fromDateTimeLocal(els.end.value),
            durations_min: durations
          })
        });
        resultsByIndex[targetIndex] = data.results || [];
        rawRecordCount += Number(data.raw_record_count || 0);
        totalRainfallMm += Number(data.total_rainfall_mm || 0);
        els.status.textContent =
          `${station.station_name} 완료 · 진행 ${completed + 1}/${targetStations.length}개 `
          + `· 결과 ${number(resultCount(), 0)}건 · 오류 ${number(errors.length, 0)}건`;
      } catch (error) {
        errors.push({
          station_id: station.station_id,
          station_name: station.station_name,
          error: error.message || String(error)
        });
        els.status.textContent =
          `${station.station_name} 오류 · 진행 ${completed + 1}/${targetStations.length}개 `
          + `· 결과 ${number(resultCount(), 0)}건 · 오류 ${number(errors.length, 0)}건`;
      } finally {
        completed += 1;
        setProgress(Math.round((completed * 1000) / targetStations.length) / 10, `${completed}/${targetStations.length}`);
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, analyzeNext));
  const results = resultsByIndex.flat().filter(Boolean);
  if (!results.length && errors.length) {
    throw new Error(errors[0].error || "중권역 분석 실패");
  }
  state.results = results;
  state.rawRecords = [];
  state.lastAnalysis = {
    ok: true,
    analysis_scope: "basin",
    middle_basin: basin,
    station_count: targetStations.length,
    completed_stations: completed,
    percent: 100,
    result_count: results.length,
    raw_record_count: rawRecordCount,
    total_rainfall_mm: Math.round(totalRainfallMm * 1000) / 1000,
    error_count: errors.length,
    errors,
    results
  };
  els.status.textContent =
    `중권역 분석 완료: ${number(targetStations.length, 0)}개 관측소, `
    + `결과 ${number(results.length, 0)}건, 오류 ${number(errors.length, 0)}건.`;
  renderAll();
}

async function pollAnalysisJob(jobId) {
  while (true) {
    await new Promise((resolve) => setTimeout(resolve, 1300));
    const data = await fetchJson(`/api/analyze/status?job_id=${encodeURIComponent(jobId)}`);
    setProgress(data.percent || 0, `${data.completed_stations || 0}/${data.station_count || 0}`);
    els.status.textContent =
      `${data.message || "분석 중"} · 진행 ${data.completed_stations || 0}/${data.station_count || 0}개 `
      + `· 결과 ${number(data.result_count || 0, 0)}건 · 오류 ${number(data.error_count || 0, 0)}건`;
    if (data.status === "failed") {
      throw new Error(data.error || data.message || "중권역 분석 실패");
    }
    if (data.status === "complete") {
      state.results = data.results || [];
      state.rawRecords = [];
      state.lastAnalysis = data;
      els.status.textContent =
        `중권역 분석 완료: ${number(data.station_count || 0, 0)}개 관측소, `
        + `결과 ${number(state.results.length, 0)}건, 오류 ${number(data.error_count || 0, 0)}건. CSV/XLSX를 받을 수 있습니다.`;
      renderAll();
      return;
    }
  }
}

function beginLoading(message) {
  els.runButton.disabled = true;
  els.runButton.classList.add("btn-loading");
  $(".button-text").textContent = isBasinMode() ? "중권역 분석 중" : "분석 중";
  els.status.textContent = message;
  setProgress(24, "원자료 호출");
  $("#summaryGrid").classList.add("is-refreshing");
  $("#resultPanel").classList.add("is-refreshing");
  els.barChart.classList.add("skeleton");
}

function endLoading() {
  setProgress(100, "완료");
  setTimeout(() => setProgress(null), 500);
  els.runButton.disabled = false;
  els.runButton.classList.remove("btn-loading");
  $(".button-text").textContent = isBasinMode() ? "중권역 전체 분석" : "분석 실행";
  $("#summaryGrid").classList.remove("is-refreshing");
  $("#resultPanel").classList.remove("is-refreshing");
  els.barChart.classList.remove("skeleton");
}

function setProgress(value, label = "") {
  if (value === null) {
    els.progressWrap.hidden = true;
    return;
  }
  els.progressWrap.hidden = false;
  els.progressFill.style.width = `${Math.max(0, Math.min(100, Number(value) || 0))}%`;
  els.progressLabel.textContent = label;
}

function renderAll() {
  renderSummary();
  renderBars();
  renderIdf();
  renderTable();
}

function renderSummary() {
  const peak = state.results.slice().sort((a, b) => Number(b.max_rainfall_mm) - Number(a.max_rainfall_mm))[0];
  const oneHour = state.results
    .filter((row) => Number(row.duration_min) === 60)
    .sort((a, b) => Number(b.max_rainfall_mm) - Number(a.max_rainfall_mm))[0];
  const maxFrequency = maxFrequencyRow();
  const maxYear = maxFrequency ? parseYear(maxFrequency.estimated_return_period_label, maxFrequency.estimated_return_period_year) : 0;
  els.peak1h.textContent = "-";
  els.totalRainfall.textContent = "-";
  els.maxFrequency.textContent = "-";
  els.peakDuration.textContent = "-";

  animateNumber(els.peak1h, Number(oneHour?.max_rainfall_mm || 0), "mm");
  animateNumber(els.totalRainfall, Number(state.lastAnalysis?.total_rainfall_mm || 0), "mm");
  els.maxFrequency.textContent = maxFrequency?.estimated_return_period_label || "-";
  els.peakDuration.textContent = peak ? durationKorean(peak.duration_min) : "-";
  els.analysisPeriod.textContent = `${fromDateTimeLocal(els.start.value)} ~ ${fromDateTimeLocal(els.end.value)}`;
  els.dbSource.textContent = "rain_2022.db.rain_2022";
  els.maxFrequencyCard.className = `stat-card fade-slide-up ${severityClass(maxYear)}`;
}

function maxFrequencyRow() {
  return state.results.slice().sort((a, b) => parseYear(b.estimated_return_period_label, b.estimated_return_period_year) - parseYear(a.estimated_return_period_label, a.estimated_return_period_year))[0];
}

function animateNumber(el, target, suffix = "", digits = 1) {
  if (!Number.isFinite(target) || target <= 0) {
    el.textContent = target === 0 ? `0${suffix}` : "-";
    return;
  }
  const start = performance.now();
  const duration = 650;
  function frame(now) {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = `${number(target * eased, digits)}${suffix}`;
    if (t < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function renderBars() {
  if (!state.results.length) {
    els.barChart.innerHTML = `<p class="status-text">분석 실행 후 지속시간별 최대강우량이 표시됩니다.</p>`;
    return;
  }
  const chartRows = peakRowsByDuration(state.results);
  const max = Math.max(...chartRows.map((row) => Number(row.max_rainfall_mm)), 1);
  els.barChart.innerHTML = chartRows
    .sort((a, b) => Number(a.duration_min) - Number(b.duration_min))
    .map((row) => {
      const width = Math.max(2, Number(row.max_rainfall_mm) / max * 100);
      const severity = severityClass(row.estimated_return_period_label, row.estimated_return_period_year);
      return `
        <div class="bar-row">
          <div class="bar-label">${durationLabel(row.duration_min)}</div>
          <div class="bar-track">
            <div class="bar-fill ${severity}" data-width="${width}">
              <span class="bar-period">${escapeHtml(row.estimated_return_period_label || "-")}</span>
            </div>
          </div>
          <div class="bar-value">${number(row.max_rainfall_mm)}mm</div>
        </div>
      `;
    }).join("");
  requestAnimationFrame(() => {
    document.querySelectorAll(".bar-fill").forEach((bar) => {
      bar.style.width = `${bar.dataset.width}%`;
    });
  });
}

function peakRowsByDuration(rows) {
  const byDuration = new Map();
  for (const row of rows) {
    const duration = Number(row.duration_min);
    const current = byDuration.get(duration);
    if (!current || Number(row.max_rainfall_mm) > Number(current.max_rainfall_mm)) {
      byDuration.set(duration, row);
    }
  }
  return [...byDuration.values()];
}

function renderIdf() {
  if (!state.designRows.length) {
    els.idfChart.innerHTML = emptySvgText("기준 지점의 확률강우량을 불러오면 IDF Curve가 표시됩니다.");
    return;
  }
  const rows = state.designRows
    .filter((row) => state.selectedDurations.has(Number(row.duration_min)))
    .map((row) => ({
      ...row,
      duration_min: Number(row.duration_min),
      return_period_year: Number(row.return_period_year),
      value: idfValue(Number(row.rainfall_mm), Number(row.duration_min))
    }));
  const observed = peakRowsByDuration(state.results).map((row) => ({
    duration_min: Number(row.duration_min),
    value: idfValue(Number(row.max_rainfall_mm), Number(row.duration_min))
  }));
  const allValues = rows.map((row) => row.value).concat(observed.map((row) => row.value)).filter(Number.isFinite);
  const maxY = Math.max(...allValues, 1) * 1.12;
  const durations = [...new Set(rows.map((row) => row.duration_min).concat(observed.map((row) => row.duration_min)))]
    .sort((a, b) => a - b);
  const periods = [...new Set(rows.map((row) => row.return_period_year))]
    .sort((a, b) => a - b);
  const selectedPeriods = choosePeriods(periods);
  const plot = { left: 58, right: 724, top: 28, bottom: 296 };
  const x = (duration) => {
    const index = durations.indexOf(duration);
    if (durations.length <= 1) return (plot.left + plot.right) / 2;
    return plot.left + (plot.right - plot.left) * index / (durations.length - 1);
  };
  const y = (value) => plot.bottom - (plot.bottom - plot.top) * value / maxY;
  const grid = [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
    const gy = plot.bottom - (plot.bottom - plot.top) * ratio;
    const label = number(maxY * ratio, state.idfMode === "rainfall" ? 0 : 1);
    return `<line class="grid-line" x1="${plot.left}" y1="${gy}" x2="${plot.right}" y2="${gy}"></line><text class="axis-text" x="12" y="${gy + 4}">${label}</text>`;
  }).join("");
  const xLabels = durations.map((duration) => `<text class="axis-text" x="${x(duration)}" y="323" text-anchor="middle">${durationLabel(duration)}</text>`).join("");
  const paths = selectedPeriods.map((period, index) => {
    const points = rows
      .filter((row) => row.return_period_year === period)
      .sort((a, b) => a.duration_min - b.duration_min)
      .map((row) => [x(row.duration_min), y(row.value)]);
    if (points.length < 2) return "";
    return `<path class="chart-path design-path" d="${pathFromPoints(points)}" stroke="${COLORS[index % COLORS.length]}"></path>`;
  }).join("");
  const observedPoints = observed
    .filter((row) => Number.isFinite(row.value))
    .sort((a, b) => a.duration_min - b.duration_min)
    .map((row) => [x(row.duration_min), y(row.value)]);
  const observedPath = observedPoints.length >= 2
    ? `<path class="chart-path observed-path" d="${pathFromPoints(observedPoints)}"></path>`
    : "";
  const observedDots = observedPoints.map(([cx, cy]) => `<circle cx="${cx}" cy="${cy}" r="4.5" fill="#111827"></circle>`).join("");
  const legend = selectedPeriods.slice(0, 8).map((period, index) => {
    const lx = 72 + index * 78;
    return `<line x1="${lx}" y1="346" x2="${lx + 20}" y2="346" stroke="${COLORS[index % COLORS.length]}" stroke-width="3"></line><text class="legend-text" x="${lx + 25}" y="350">${period}년</text>`;
  }).join("") + `<line x1="650" y1="346" x2="670" y2="346" stroke="#111827" stroke-width="4"></line><text class="legend-text" x="676" y="350">관측</text>`;
  const unit = state.idfMode === "rainfall" ? "누적강우량(mm)" : "강우강도(mm/hr)";
  els.idfChart.innerHTML = `
    <rect x="0" y="0" width="760" height="360" fill="transparent"></rect>
    ${grid}
    <line class="axis-line" x1="${plot.left}" y1="${plot.bottom}" x2="${plot.right}" y2="${plot.bottom}"></line>
    <line class="axis-line" x1="${plot.left}" y1="${plot.top}" x2="${plot.left}" y2="${plot.bottom}"></line>
    ${xLabels}
    <text class="axis-text" x="58" y="18">${unit}</text>
    ${paths}
    ${observedPath}
    ${observedDots}
    ${legend}
  `;
}

function idfValue(rainfallMm, durationMin) {
  if (state.idfMode === "intensity") return rainfallMm * 60 / durationMin;
  return rainfallMm;
}

function choosePeriods(periods) {
  const preferred = [2, 5, 10, 20, 30, 50, 80, 100, 200, 500].filter((period) => periods.includes(period));
  return preferred.length ? preferred : periods.slice(0, 10);
}

function pathFromPoints(points) {
  return points.map(([x, y], index) => `${index ? "L" : "M"} ${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
}

function emptySvgText(message) {
  return `<text x="380" y="180" text-anchor="middle" fill="#64748b" font-size="15" font-weight="800">${escapeHtml(message)}</text>`;
}

function compareResultTableRows(a, b) {
  const stationA = String(a.station_id || a.station_name || a.design_station_code || "");
  const stationB = String(b.station_id || b.station_name || b.design_station_code || "");
  const stationCompare = stationA.localeCompare(stationB, "ko-KR", { numeric: true, sensitivity: "base" });
  if (stationCompare) return stationCompare;
  const nameCompare = String(a.station_name || "").localeCompare(String(b.station_name || ""), "ko-KR", { numeric: true, sensitivity: "base" });
  if (nameCompare) return nameCompare;
  return Number(a.duration_min) - Number(b.duration_min);
}

function renderTable() {
  if (!state.results.length) {
    els.rows.innerHTML = `<tr><td colspan="10">분석을 실행하면 결과가 표시됩니다.</td></tr>`;
    return;
  }
  els.rows.innerHTML = state.results
    .slice()
    .sort(compareResultTableRows)
    .map((row) => {
      const severity = severityClass(row.estimated_return_period_label, row.estimated_return_period_year);
      return `
        <tr>
          <td>${escapeHtml(row.station_name || "")}</td>
          <td>${escapeHtml(row.station_id || "")}</td>
          <td>${escapeHtml(row.design_station_code || row.region || "")}</td>
          <td>${durationKorean(row.duration_min)}</td>
          <td>${number(row.max_rainfall_mm)}mm</td>
          <td>${number(row.intensity_mm_per_hr)}mm/hr</td>
          <td>${escapeHtml(row.start_time || "")}</td>
          <td>${escapeHtml(row.end_time || "")}</td>
          <td>${row.design_rainfall_mm === "" ? "-" : `${number(row.design_rainfall_mm)}mm`}</td>
          <td><span class="frequency-chip ${severity}">${escapeHtml(row.estimated_return_period_label || "-")}</span></td>
        </tr>
      `;
    }).join("");
}

function downloadAnalysisResults(format, event) {
  event?.preventDefault();
  if (!state.results.length) {
    els.status.textContent = "다운로드할 분석 결과가 없습니다. 먼저 분석을 실행하세요.";
    return;
  }
  const rows = downloadRows();
  const table = [RESULT_DOWNLOAD_COLUMNS.map(([, label]) => label), ...rows];
  const extension = format === "xlsx" ? "xlsx" : "csv";
  const blob = extension === "xlsx" ? xlsxBlob(table) : csvBlob(table);
  downloadBlob(blob, `${downloadFileStem()}.${extension}`);
  els.status.textContent = `분석 결과 ${number(state.results.length, 0)}건을 ${extension.toUpperCase()}로 다운로드했습니다.`;
}

function downloadRows() {
  return state.results
    .slice()
    .sort(compareResultTableRows)
    .map((row) => RESULT_DOWNLOAD_COLUMNS.map(([key]) => downloadCellValue(row, key)));
}

function downloadCellValue(row, key) {
  if (key === "design_station_code") return row.design_station_code || row.region || "";
  if (key === "observation_source") return row.observation_source || row.source_provider || initial.source_provider || "기후부, 수자원공사, 기상청";
  if (key === "duration_label") return row.duration_label || durationKorean(row.duration_min);
  if (key === "design_rainfall_mm") return row.design_rainfall_mm ?? "";
  return row[key] ?? "";
}

function csvBlob(table) {
  const csv = "\uFEFF" + table.map((row) => row.map(csvCell).join(",")).join("\r\n");
  return new Blob([csv], { type: "text/csv;charset=utf-8" });
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function xlsxBlob(table) {
  const files = [
    { name: "[Content_Types].xml", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>` },
    { name: "_rels/.rels", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="analysis_result" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "xl/styles.xml", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>` },
    { name: "xl/worksheets/sheet1.xml", content: worksheetXml(table) }
  ];
  return zipBlob(files, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}

function worksheetXml(table) {
  const rows = table.map((row, rowIndex) => {
    const cells = row.map((value, colIndex) => cellXml(`${columnLetter(colIndex + 1)}${rowIndex + 1}`, value)).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;
}

function cellXml(ref, value) {
  if (typeof value === "number" && Number.isFinite(value)) return `<c r="${ref}"><v>${value}</v></c>`;
  return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`;
}

function columnLetter(index) {
  let letters = "";
  while (index > 0) {
    const remainder = (index - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    index = Math.floor((index - 1) / 26);
  }
  return letters;
}

function xmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function zipBlob(files, type) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const now = new Date();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const data = encoder.encode(file.content);
    const crc = crc32(data);
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(localHeader.buffer);
    setUint32(localView, 0, 0x04034b50);
    setUint16(localView, 4, 20);
    setUint16(localView, 6, 0x0800);
    setUint16(localView, 8, 0);
    setUint16(localView, 10, time);
    setUint16(localView, 12, date);
    setUint32(localView, 14, crc);
    setUint32(localView, 18, data.length);
    setUint32(localView, 22, data.length);
    setUint16(localView, 26, nameBytes.length);
    localHeader.set(nameBytes, 30);
    localParts.push(localHeader, data);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(centralHeader.buffer);
    setUint32(centralView, 0, 0x02014b50);
    setUint16(centralView, 4, 20);
    setUint16(centralView, 6, 20);
    setUint16(centralView, 8, 0x0800);
    setUint16(centralView, 10, 0);
    setUint16(centralView, 12, time);
    setUint16(centralView, 14, date);
    setUint32(centralView, 16, crc);
    setUint32(centralView, 20, data.length);
    setUint32(centralView, 24, data.length);
    setUint16(centralView, 28, nameBytes.length);
    setUint32(centralView, 42, offset);
    centralHeader.set(nameBytes, 46);
    centralParts.push(centralHeader);
    offset += localHeader.length + data.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const endHeader = new Uint8Array(22);
  const endView = new DataView(endHeader.buffer);
  setUint32(endView, 0, 0x06054b50);
  setUint16(endView, 8, files.length);
  setUint16(endView, 10, files.length);
  setUint32(endView, 12, centralSize);
  setUint32(endView, 16, offset);
  return new Blob([...localParts, ...centralParts, endHeader], { type });
}

function setUint16(view, offset, value) {
  view.setUint16(offset, value, true);
}

function setUint32(view, offset, value) {
  view.setUint32(offset, value >>> 0, true);
}

let crcTableCache = null;
function crc32(bytes) {
  const table = crcTableCache || (crcTableCache = makeCrcTable());
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeCrcTable() {
  return Array.from({ length: 256 }, (_, index) => {
    let c = index;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    return c >>> 0;
  });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function downloadFileStem() {
  const scope = isBasinMode() ? `basin_${els.basin.value || "all"}` : `station_${els.stationId.value || "result"}`;
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
  return `rainfall_frequency_${safeFilePart(scope)}_${stamp}`;
}

function safeFilePart(value) {
  return String(value || "result")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 80) || "result";
}

async function downloadRawCsv() {
  if (isBasinMode()) {
    els.status.textContent = "중권역 전체 원자료는 용량이 커서 결과 CSV/XLSX로 받도록 구성했습니다. 원자료 CSV는 개별 관측소 모드에서 받으세요.";
    return;
  }
  if (!els.stationId.value) {
    els.status.textContent = "원자료를 받을 관측소를 먼저 선택하세요.";
    return;
  }
  els.rawButton.disabled = true;
  try {
    const response = await fetch(apiUrl("/api/rainfall/raw"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        station_id: els.stationId.value.trim(),
        station_name: selectedOptionData(els.stationSelect).name || els.stationId.value.trim(),
        region: els.designSelect.value,
        start_time: fromDateTimeLocal(els.start.value),
        end_time: fromDateTimeLocal(els.end.value),
        durations_min: [...state.selectedDurations]
      })
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "원자료 CSV 다운로드 실패");
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `raw_rainfall_10m_${els.stationId.value}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    els.status.textContent = "원자료 CSV를 다운로드했습니다.";
  } catch (error) {
    els.status.textContent = error.message;
  } finally {
    els.rawButton.disabled = false;
  }
}

async function fetchJson(url, options) {
  const response = await fetch(apiUrl(url), options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || `${url} 호출 실패`);
  }
  return data;
}

function apiUrl(url) {
  if (!String(url).startsWith("/api/")) return url;
  if (IS_LOCAL_API_HOST) return url;
  if (!API_BASE) {
    throw new Error("실시간 분석 API가 연결되어 있지 않습니다.");
  }
  return API_BASE + url;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

els.stationSearch.addEventListener("input", () => {
  const current = els.stationSelect.value;
  populateStationSelect();
  if ([...els.stationSelect.options].some((option) => option.value === current)) {
    els.stationSelect.value = current;
  }
  syncStationFields();
});

els.analysisMode.addEventListener("change", () => {
  updateAnalysisMode();
  loadDesignRows();
});

els.basin.addEventListener("change", () => {
  if (els.basin.value) {
    els.analysisMode.value = "basin";
  }
  const current = els.stationSelect.value;
  populateStationSelect();
  if ([...els.stationSelect.options].some((option) => option.value === current)) {
    els.stationSelect.value = current;
  }
  updateAnalysisMode();
  loadDesignRows();
});

els.stationSelect.addEventListener("change", () => {
  syncStationFields();
  loadDesignRows();
});

els.designSelect.addEventListener("change", loadDesignRows);

els.durationButtons.addEventListener("click", (event) => {
  const button = event.target.closest("[data-duration]");
  if (!button) return;
  const duration = Number(button.dataset.duration);
  if (state.selectedDurations.has(duration)) {
    if (state.selectedDurations.size === 1) return;
    state.selectedDurations.delete(duration);
  } else {
    state.selectedDurations.add(duration);
  }
  renderDurationButtons();
  renderIdf();
});

document.querySelectorAll("[data-idf-mode]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll("[data-idf-mode]").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    state.idfMode = button.dataset.idfMode;
    renderIdf();
  });
});

els.runButton.addEventListener("click", runAnalysis);
els.rawButton.addEventListener("click", downloadRawCsv);
els.downloadButtons.forEach((link) => {
  link.addEventListener("click", (event) => downloadAnalysisResults(link.dataset.downloadFormat || "csv", event));
});
els.refreshButton.addEventListener("click", async () => {
  els.status.textContent = "기준 지점과 관측소 목록을 다시 불러오는 중입니다.";
  await loadInitialData();
});

initializeInputs();
loadInitialData();
