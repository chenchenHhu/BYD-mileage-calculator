(function () {
  "use strict";

  const APP_VERSION = "1.1.1";
  const STORAGE_KEY = "byd-han-lev-mileage-data-v1";
  const LARGE_JUMP_KM = 2000;
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const TABS = [
    { id: "home", label: "首页" },
    { id: "records", label: "记录" },
    { id: "charts", label: "图表" },
    { id: "settings", label: "设置" }
  ];

  const state = {
    vehicleProfile: null,
    records: [],
    activeTab: "home",
    wizardStep: "start",
    wizardDraft: null,
    importMode: "app",
    deferredInstallPrompt: null
  };

  const dom = {
    app: document.getElementById("app"),
    toast: document.getElementById("toast"),
    importInput: document.getElementById("jsonImportInput")
  };

  init();

  function init() {
    registerServiceWorker();
    loadData();
    bindGlobalEvents();
    render();
  }

  function bindGlobalEvents() {
    dom.importInput.addEventListener("change", handleImportFile);

    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      state.deferredInstallPrompt = event;
      if (hasUsableData()) {
        render();
      }
    });

    window.addEventListener("resize", debounce(() => {
      if (hasUsableData()) {
        renderCharts();
      }
    }, 200));

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeModal();
      }
    });
  }

  function registerServiceWorker() {
    const canRegister = "serviceWorker" in navigator &&
      (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1");

    if (!canRegister) {
      return;
    }

    navigator.serviceWorker.register("./service-worker.js").catch((error) => {
      console.warn("Service worker registration failed:", error);
    });
  }

  function loadData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        state.vehicleProfile = null;
        state.records = [];
        return;
      }

      const parsed = JSON.parse(raw);
      state.vehicleProfile = parsed.vehicleProfile ? normalizeVehicleProfile(parsed.vehicleProfile) : null;
      state.records = Array.isArray(parsed.records) ? normalizeRecords(parsed.records) : [];
    } catch (error) {
      console.error(error);
      state.vehicleProfile = null;
      state.records = [];
      showToast("本地数据读取失败，已进入初始化向导。原数据没有上传。");
    }
  }

  function saveData() {
    const payload = {
      appVersion: APP_VERSION,
      savedAt: new Date().toISOString(),
      vehicleProfile: state.vehicleProfile,
      records: sortRecords(state.records)
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }

  function hasUsableData() {
    return Boolean(state.vehicleProfile && state.records.length > 0);
  }

  function normalizeVehicleProfile(input) {
    const now = new Date().toISOString();
    const purchase = parsePurchaseDate(input.purchaseDateText || input.purchaseDateForCalc || "");
    const purchaseDateForCalc = isValidDateString(input.purchaseDateForCalc)
      ? input.purchaseDateForCalc
      : purchase.dateForCalc;

    return {
      id: input.id || "vehicle-001",
      vehicleName: String(input.vehicleName || "比亚迪汉LEV").trim() || "比亚迪汉LEV",
      limitKm: toNumber(input.limitKm, 30000),
      warningKm: toNumber(input.warningKm, 27000),
      highRiskKm: toNumber(input.highRiskKm, 28500),
      safetyBufferKm: toNumber(input.safetyBufferKm, 1500),
      purchaseDateText: String(input.purchaseDateText || "").trim(),
      purchaseDateForCalc,
      purchaseDatePrecision: input.purchaseDatePrecision || purchase.precision,
      purchaseOdometerKm: toNumber(input.purchaseOdometerKm, 0),
      modelVersion: String(input.modelVersion || ""),
      plateNumber: String(input.plateNumber || ""),
      warrantyNote: String(input.warrantyNote || "任意连续12个月不超过30000 km"),
      otherNote: String(input.otherNote || ""),
      createdAt: input.createdAt || now,
      updatedAt: input.updatedAt || input.createdAt || now
    };
  }

  function normalizeRecords(records) {
    return sortRecords(records.map((record) => ({
      id: record.id || createId(),
      date: String(record.date || ""),
      odometerKm: toNumber(record.odometerKm, 0),
      note: String(record.note || ""),
      createdAt: record.createdAt || new Date().toISOString(),
      updatedAt: record.updatedAt || record.createdAt || new Date().toISOString()
    })).filter((record) => isValidDateString(record.date) && Number.isFinite(record.odometerKm)));
  }

  function sortRecords(records) {
    return [...records].sort((a, b) => a.date.localeCompare(b.date) || a.updatedAt.localeCompare(b.updatedAt));
  }

  function createDefaultProfile() {
    const now = new Date().toISOString();
    const purchase = parsePurchaseDate("2025年7月左右");
    return {
      id: "vehicle-001",
      vehicleName: "比亚迪汉LEV",
      limitKm: 30000,
      warningKm: 27000,
      highRiskKm: 28500,
      safetyBufferKm: 1500,
      purchaseDateText: "2025年7月左右",
      purchaseDateForCalc: purchase.dateForCalc,
      purchaseDatePrecision: purchase.precision,
      purchaseOdometerKm: 0,
      modelVersion: "",
      plateNumber: "",
      warrantyNote: "任意连续12个月不超过30000 km",
      otherNote: "",
      createdAt: now,
      updatedAt: now
    };
  }

  function createId() {
    if (crypto && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  function toNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function parsePurchaseDate(text) {
    const value = String(text || "").trim();
    if (!value) {
      return { text: "", dateForCalc: "", precision: "unknown" };
    }

    const isoDay = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoDay && isValidDateString(value)) {
      return { text: value, dateForCalc: value, precision: "day" };
    }

    const isoMonth = value.match(/^(\d{4})-(\d{1,2})$/);
    if (isoMonth) {
      const year = Number(isoMonth[1]);
      const month = Number(isoMonth[2]);
      if (month >= 1 && month <= 12) {
        return { text: value, dateForCalc: `${year}-${pad(month)}-01`, precision: "month" };
      }
    }

    const cnDay = value.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/);
    if (cnDay) {
      const iso = `${cnDay[1]}-${pad(cnDay[2])}-${pad(cnDay[3])}`;
      if (isValidDateString(iso)) {
        return { text: value, dateForCalc: iso, precision: "day" };
      }
    }

    const cnMonth = value.match(/(\d{4})\s*年\s*(\d{1,2})\s*月/);
    if (cnMonth) {
      const month = Number(cnMonth[2]);
      if (month >= 1 && month <= 12) {
        const precision = /左右|大约|约|前后/.test(value) ? "approx" : "month";
        return { text: value, dateForCalc: `${cnMonth[1]}-${pad(month)}-01`, precision };
      }
    }

    return { text: value, dateForCalc: "", precision: "unknown" };
  }

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function todayIso() {
    return dateToIso(new Date());
  }

  function isValidDateString(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) {
      return false;
    }
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(year, month - 1, day, 12, 0, 0, 0);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
  }

  function dateToIso(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function toLocalDate(value) {
    if (value instanceof Date) {
      return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 12, 0, 0, 0);
    }
    const [year, month, day] = String(value).split("-").map(Number);
    return new Date(year, month - 1, day, 12, 0, 0, 0);
  }

  function dateToTime(value) {
    return toLocalDate(value).getTime();
  }

  function daysBetween(startDate, endDate) {
    return Math.round((dateToTime(endDate) - dateToTime(startDate)) / MS_PER_DAY);
  }

  function subtractDays(dateValue, days) {
    const date = toLocalDate(dateValue);
    date.setDate(date.getDate() - days);
    return dateToIso(date);
  }

  // 按日历月回退，月底或闰年日期自动退到目标月份最后一天。
  function subtractMonths(dateValue, months) {
    const source = toLocalDate(dateValue);
    const firstOfTarget = new Date(source.getFullYear(), source.getMonth() - months, 1, 12, 0, 0, 0);
    const lastDay = new Date(firstOfTarget.getFullYear(), firstOfTarget.getMonth() + 1, 0).getDate();
    const targetDay = Math.min(source.getDate(), lastDay);
    return dateToIso(new Date(firstOfTarget.getFullYear(), firstOfTarget.getMonth(), targetDay, 12, 0, 0, 0));
  }

  function validateRecord(record, options = {}) {
    const records = options.records || state.records;
    const replacingId = options.replacingId || "";

    if (!isValidDateString(record.date)) {
      return { ok: false, message: "日期格式不正确，请使用 YYYY-MM-DD。" };
    }
    if (!Number.isFinite(record.odometerKm) || record.odometerKm < 0) {
      return { ok: false, message: "总里程必须是非负数字。" };
    }

    const simulated = sortRecords([
      ...records.filter((item) => item.id !== replacingId),
      record
    ]);

    const seenDates = new Set();
    for (const item of simulated) {
      if (seenDates.has(item.date)) {
        return { ok: false, message: `日期 ${item.date} 已有记录，请使用覆盖方式保存。` };
      }
      seenDates.add(item.date);
    }

    for (let index = 1; index < simulated.length; index += 1) {
      if (simulated[index].odometerKm < simulated[index - 1].odometerKm) {
        return {
          ok: false,
          message: `总里程不能倒退：${simulated[index].date} 的里程小于上一条记录。`
        };
      }
    }

    return { ok: true, message: "" };
  }

  function addRecord(input) {
    const existing = state.records.find((record) => record.date === input.date);
    const now = new Date().toISOString();
    const record = {
      id: existing ? existing.id : createId(),
      date: input.date,
      odometerKm: Number(input.odometerKm),
      note: String(input.note || "").trim(),
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now
    };

    if (existing) {
      const shouldOverwrite = window.confirm(`${record.date} 已经有记录，是否覆盖当天记录？`);
      if (!shouldOverwrite) {
        return { saved: false, message: "已取消覆盖。" };
      }
    }

    const validation = validateRecord(record, {
      replacingId: existing ? existing.id : "",
      records: state.records
    });
    if (!validation.ok) {
      throw new Error(validation.message);
    }

    const previous = getPreviousRecord(record.date, existing ? existing.id : "");
    if (previous && record.odometerKm - previous.odometerKm > LARGE_JUMP_KM) {
      const ok = window.confirm(`相比上一条记录增加了 ${formatKm(record.odometerKm - previous.odometerKm)}，是否确认保存？`);
      if (!ok) {
        return { saved: false, message: "已取消保存。" };
      }
    }

    state.records = existing
      ? state.records.map((item) => item.id === existing.id ? record : item)
      : [...state.records, record];
    state.records = sortRecords(state.records);
    saveData();
    return { saved: true, message: existing ? "已覆盖当天记录。" : "记录已保存。" };
  }

  function updateRecord(id, input) {
    const existing = state.records.find((record) => record.id === id);
    if (!existing) {
      throw new Error("未找到要编辑的记录。");
    }

    const record = {
      id: existing.id,
      date: input.date,
      odometerKm: Number(input.odometerKm),
      note: String(input.note || "").trim(),
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString()
    };

    const sameDateRecord = state.records.find((item) => item.date === record.date && item.id !== id);
    if (sameDateRecord) {
      throw new Error(`${record.date} 已经有另一条记录，请先编辑或删除那条记录。`);
    }

    const validation = validateRecord(record, { replacingId: id, records: state.records });
    if (!validation.ok) {
      throw new Error(validation.message);
    }

    const previous = getPreviousRecord(record.date, id);
    if (previous && record.odometerKm - previous.odometerKm > LARGE_JUMP_KM) {
      const ok = window.confirm(`相比上一条记录增加了 ${formatKm(record.odometerKm - previous.odometerKm)}，是否确认保存？`);
      if (!ok) {
        return { saved: false, message: "已取消保存。" };
      }
    }

    state.records = sortRecords(state.records.map((item) => item.id === id ? record : item));
    saveData();
    return { saved: true, message: "记录已更新。" };
  }

  function deleteRecord(id) {
    const record = state.records.find((item) => item.id === id);
    if (!record) {
      return;
    }
    const ok = window.confirm(`确认删除 ${record.date} 的 ${formatKm(record.odometerKm)} 记录吗？`);
    if (!ok) {
      return;
    }
    state.records = state.records.filter((item) => item.id !== id);
    saveData();
    render();
    showToast("记录已删除，统计已重新计算。");
  }

  function getPreviousRecord(date, excludingId = "") {
    return sortRecords(state.records)
      .filter((record) => record.id !== excludingId && record.date < date)
      .at(-1) || null;
  }

  // 估算某一天的总里程：精确命中、两点间插值，或在早期数据不足时使用购车里程做保守参考。
  function estimateOdometerAtDate(date, records = state.records, profile = state.vehicleProfile) {
    if (!isValidDateString(date)) {
      return { odometerKm: null, method: "数据不足", note: "目标日期无效。" };
    }

    const sorted = sortRecords(records);
    if (!sorted.length) {
      return { odometerKm: null, method: "数据不足", note: "还没有里程记录。" };
    }

    const exact = sorted.find((record) => record.date === date);
    if (exact) {
      return { odometerKm: exact.odometerKm, method: "精确", note: "目标日期有真实记录。" };
    }

    let previous = null;
    let next = null;
    for (const record of sorted) {
      if (record.date < date) {
        previous = record;
      }
      if (record.date > date) {
        next = record;
        break;
      }
    }

    if (previous && next) {
      const spanDays = Math.max(1, daysBetween(previous.date, next.date));
      const offsetDays = Math.max(0, daysBetween(previous.date, date));
      const ratio = offsetDays / spanDays;
      const estimated = previous.odometerKm + ratio * (next.odometerKm - previous.odometerKm);
      return {
        odometerKm: estimated,
        method: "插值估算",
        note: `${date} 位于 ${previous.date} 与 ${next.date} 之间。`
      };
    }

    if (!previous) {
      const purchaseKm = Number(profile && profile.purchaseOdometerKm);
      if (Number.isFinite(purchaseKm) && purchaseKm >= 0) {
        return {
          odometerKm: purchaseKm,
          method: "保守估算",
          note: "目标日期早于首条真实记录，按购车时里程做保守参考。"
        };
      }
      return {
        odometerKm: null,
        method: "数据不足",
        note: "缺少12个月前记录，也缺少购车时里程。"
      };
    }

    return {
      odometerKm: null,
      method: "数据不足",
      note: "目标日期晚于最后一条记录，无法估算。"
    };
  }

  function calculateWindowMileage(record, records = state.records, profile = state.vehicleProfile) {
    if (!record) {
      return emptyWindowResult();
    }

    const startDate = subtractMonths(record.date, 12);
    const estimate = estimateOdometerAtDate(startDate, records, profile);
    if (!Number.isFinite(estimate.odometerKm)) {
      return {
        ...emptyWindowResult(),
        startDate,
        endDate: record.date,
        calculationMethod: estimate.method,
        note: estimate.note
      };
    }

    const windowMileage = Math.max(0, record.odometerKm - estimate.odometerKm);
    const remainingKm = profile.limitKm - windowMileage;
    const recommendedAvailableKm = remainingKm - profile.safetyBufferKm;

    return {
      startDate,
      endDate: record.date,
      estimatedStartOdometerKm: estimate.odometerKm,
      windowMileage,
      remainingKm,
      recommendedAvailableKm,
      calculationMethod: estimate.method,
      note: estimate.note,
      risk: calculateRiskLevel(windowMileage, profile)
    };
  }

  function emptyWindowResult() {
    return {
      startDate: "",
      endDate: "",
      estimatedStartOdometerKm: null,
      windowMileage: null,
      remainingKm: null,
      recommendedAvailableKm: null,
      calculationMethod: "数据不足",
      note: "数据不足，继续记录后可计算。",
      risk: calculateRiskLevel(null, state.vehicleProfile)
    };
  }

  function calculateRiskLevel(windowMileage, profile = state.vehicleProfile) {
    if (!Number.isFinite(windowMileage)) {
      return { label: "数据不足", className: "unknown", description: "继续记录后可计算" };
    }

    const limitKm = Number(profile && profile.limitKm) || 30000;
    const warningKm = Number(profile && profile.warningKm) || 27000;
    const highRiskKm = Number(profile && profile.highRiskKm) || 28500;
    const attentionKm = Math.max(0, warningKm - 2000);

    if (windowMileage >= limitKm) {
      return { label: "已超限", className: "over", description: "已达到或超过厂家上限" };
    }
    if (windowMileage > highRiskKm) {
      return { label: "高风险", className: "danger", description: "非常接近厂家上限" };
    }
    if (windowMileage > warningKm) {
      return { label: "预警", className: "warning", description: "建议控制非必要行驶" };
    }
    if (windowMileage > attentionKm) {
      return { label: "注意", className: "watch", description: "里程消耗偏高" };
    }
    return { label: "安全", className: "safe", description: "当前窗口余量充足" };
  }

  function calculateCurrentStats(records = state.records, profile = state.vehicleProfile) {
    const sorted = sortRecords(records);
    const latest = sorted.at(-1);
    if (!latest) {
      return {
        latest: null,
        ...emptyWindowResult(),
        historicalMax: null
      };
    }

    const current = calculateWindowMileage(latest, sorted, profile);
    return {
      latest,
      ...current,
      historicalMax: calculateHistoricalMaxWindow(sorted, profile)
    };
  }

  function calculateHistoricalMaxWindow(records = state.records, profile = state.vehicleProfile) {
    const windows = sortRecords(records)
      .map((record) => ({ record, result: calculateWindowMileage(record, records, profile) }))
      .filter((item) => Number.isFinite(item.result.windowMileage));

    if (!windows.length) {
      return null;
    }

    return windows.reduce((best, item) => (
      item.result.windowMileage > best.result.windowMileage ? item : best
    ), windows[0]);
  }

  function calculateDailyAverages(records = state.records, profile = state.vehicleProfile) {
    const sorted = sortRecords(records);
    const latest = sorted.at(-1);
    const first = sorted[0];
    const result = {
      avg7: null,
      avg30: null,
      avg90: null,
      allTime: null
    };

    if (!latest || sorted.length < 2) {
      return result;
    }

    for (const period of [7, 30, 90]) {
      const startDate = subtractDays(latest.date, period);
      if (first.date > startDate) {
        result[`avg${period}`] = null;
        continue;
      }
      const estimate = estimateOdometerAtDate(startDate, sorted, profile);
      if (!Number.isFinite(estimate.odometerKm)) {
        result[`avg${period}`] = null;
        continue;
      }
      result[`avg${period}`] = {
        value: Math.max(0, (latest.odometerKm - estimate.odometerKm) / period),
        method: estimate.method
      };
    }

    const allDays = daysBetween(first.date, latest.date);
    if (allDays > 0) {
      result.allTime = {
        value: Math.max(0, (latest.odometerKm - first.odometerKm) / allDays),
        method: "真实记录"
      };
    }

    return result;
  }

  function render() {
    if (hasUsableData()) {
      renderApp();
    } else {
      renderWizard();
    }
  }

  function renderWizard() {
    if (state.wizardStep === "profile") {
      renderWizardProfile();
      return;
    }
    if (state.wizardStep === "record") {
      renderWizardRecord();
      return;
    }
    if (state.wizardStep === "preview") {
      renderWizardPreview();
      return;
    }
    renderWizardStart();
  }

  function renderWizardStart() {
    dom.app.innerHTML = `
      <section class="wizard-shell">
        <div class="wizard-panel">
          <div class="wizard-brand">
            <img class="app-icon" src="icons/icon-192.png" alt="">
            <div>
              <h1>比亚迪汉LEV里程计数器</h1>
              <p class="hint">离线 PWA，本机保存，不上传数据。</p>
            </div>
          </div>
          <p class="wizard-copy">本工具用于记录日期和车辆总里程，自动计算任意连续12个月累计里程是否接近30000 km上限。数据仅保存在本机，不上传、不联网、不调用AI。</p>
          <div class="wizard-actions">
            <button class="primary-button big-choice" data-wizard-action="import">
              导入已有数据
              <span>换手机、换浏览器、电脑查看或恢复 JSON 备份时使用。</span>
            </button>
            <button class="secondary-button big-choice" data-wizard-action="manual">
              手动建立车辆档案
              <span>第一次使用，从车辆信息和第一条真实里程记录开始。</span>
            </button>
            <button class="text-button" data-wizard-action="demo">使用示例数据试试看</button>
          </div>
          <p id="wizardStatus" class="hint"></p>
        </div>
      </section>
    `;
    bindWizardStartEvents();
  }

  function bindWizardStartEvents() {
    dom.app.querySelector('[data-wizard-action="import"]').addEventListener("click", () => {
      state.importMode = "wizard";
      dom.importInput.value = "";
      dom.importInput.click();
    });

    dom.app.querySelector('[data-wizard-action="manual"]').addEventListener("click", () => {
      state.wizardDraft = { profile: createDefaultProfile(), record: null };
      state.wizardStep = "profile";
      renderWizard();
    });

    dom.app.querySelector('[data-wizard-action="demo"]').addEventListener("click", () => {
      const ok = window.confirm("示例数据会写入当前浏览器本地存储，确认创建吗？");
      if (!ok) {
        return;
      }
      seedExampleData();
      state.activeTab = "home";
      render();
      showToast("示例数据已创建。你可以在数据管理里导出或在设置里修改。");
    });
  }

  function renderWizardProfile() {
    const profile = state.wizardDraft && state.wizardDraft.profile ? state.wizardDraft.profile : createDefaultProfile();
    dom.app.innerHTML = `
      <section class="wizard-shell">
        <form id="wizardProfileForm" class="wizard-panel">
          ${renderStepper(1)}
          <h1>车辆档案</h1>
          <p class="wizard-copy">购车时间用于早期保守估算；首次记录日期会在下一步填写，它们不是一回事。</p>
          <div class="grid-form">
            ${fieldHtml("vehicleName", "车辆名称", "text", profile.vehicleName, true)}
            ${fieldHtml("limitKm", "任意连续12个月上限 km", "number", profile.limitKm, true)}
            ${fieldHtml("purchaseDateText", "购车时间", "text", profile.purchaseDateText, false, "例如 2025-07-15、2025-07、2025年7月左右")}
            ${fieldHtml("purchaseOdometerKm", "购车时里程 km", "number", profile.purchaseOdometerKm, false)}
            ${fieldHtml("safetyBufferKm", "安全余量 km", "number", profile.safetyBufferKm, false)}
            <details class="form-details">
              <summary>更多设置</summary>
              <div class="grid-form">
                ${fieldHtml("warningKm", "预警线 km", "number", profile.warningKm, false)}
                ${fieldHtml("highRiskKm", "高风险线 km", "number", profile.highRiskKm, false)}
                ${fieldHtml("modelVersion", "车型配置", "text", profile.modelVersion, false)}
                ${fieldHtml("plateNumber", "车牌号", "text", profile.plateNumber, false)}
                ${textareaHtml("warrantyNote", "保险/质保备注", profile.warrantyNote)}
                ${textareaHtml("otherNote", "其他备注", profile.otherNote)}
              </div>
            </details>
          </div>
          <div class="button-row">
            <button class="primary-button" type="submit">下一步：首次里程记录</button>
            <button class="secondary-button" type="button" data-wizard-action="back-start">返回</button>
          </div>
        </form>
      </section>
    `;

    dom.app.querySelector("#wizardProfileForm").addEventListener("submit", handleWizardProfileSubmit);
    dom.app.querySelector('[data-wizard-action="back-start"]').addEventListener("click", () => {
      state.wizardStep = "start";
      renderWizard();
    });
  }

  function handleWizardProfileSubmit(event) {
    event.preventDefault();
    try {
      const profile = vehicleProfileFromForm(event.currentTarget, state.wizardDraft && state.wizardDraft.profile);
      state.wizardDraft = { ...(state.wizardDraft || {}), profile };
      state.wizardStep = "record";
      renderWizard();
    } catch (error) {
      showToast(error.message);
    }
  }

  function renderWizardRecord() {
    const record = state.wizardDraft && state.wizardDraft.record;
    dom.app.innerHTML = `
      <section class="wizard-shell">
        <form id="wizardRecordForm" class="wizard-panel">
          ${renderStepper(2)}
          <h1>首次里程记录</h1>
          <p class="wizard-copy">这一步填写第一条真实记录，也就是你当天在车机上看到的总里程。</p>
          <div class="grid-form">
            ${fieldHtml("date", "首次记录日期", "date", record ? record.date : todayIso(), true)}
            ${fieldHtml("odometerKm", "首次记录总里程 km", "number", record ? record.odometerKm : "", true, "例如 27413")}
            ${textareaHtml("note", "备注", record ? record.note : "第一条基准记录")}
          </div>
          <p class="hint">示例：2026-07-08，27413 km。示例不会自动写入，除非你自己填写或选择示例数据。</p>
          <div class="button-row">
            <button class="primary-button" type="submit">下一步：初始化预览</button>
            <button class="secondary-button" type="button" data-wizard-action="back-profile">返回修改</button>
          </div>
        </form>
      </section>
    `;

    dom.app.querySelector("#wizardRecordForm").addEventListener("submit", handleWizardRecordSubmit);
    dom.app.querySelector('[data-wizard-action="back-profile"]').addEventListener("click", () => {
      state.wizardStep = "profile";
      renderWizard();
    });
  }

  function handleWizardRecordSubmit(event) {
    event.preventDefault();
    try {
      const form = event.currentTarget;
      const now = new Date().toISOString();
      const record = {
        id: createId(),
        date: form.elements.date.value,
        odometerKm: Number(form.elements.odometerKm.value),
        note: form.elements.note.value.trim(),
        createdAt: now,
        updatedAt: now
      };
      const validation = validateRecord(record, { records: [], replacingId: "" });
      if (!validation.ok) {
        throw new Error(validation.message);
      }
      state.wizardDraft = { ...(state.wizardDraft || {}), record };
      state.wizardStep = "preview";
      renderWizard();
    } catch (error) {
      showToast(error.message);
    }
  }

  function renderWizardPreview() {
    const profile = state.wizardDraft.profile;
    const record = state.wizardDraft.record;
    const stats = calculateCurrentStats([record], profile);
    dom.app.innerHTML = `
      <section class="wizard-shell">
        <div class="wizard-panel">
          ${renderStepper(3)}
          <h1>初始化预览</h1>
          <div class="preview-list">
            ${previewRow("车辆", profile.vehicleName)}
            ${previewRow("购车时间", profile.purchaseDateText || "未填写")}
            ${previewRow("首次记录", `${record.date}，${formatKm(record.odometerKm)}`)}
            ${previewRow("厂家上限", `任意连续12个月 ${formatKm(profile.limitKm)}`)}
            ${previewRow("安全余量", formatKm(profile.safetyBufferKm))}
            ${previewRow("最近12个月已用", `约 ${formatKm(stats.windowMileage)}`)}
            ${previewRow("剩余额度", `约 ${formatKm(stats.remainingKm)}`)}
            ${previewRow("建议可用", `约 ${formatKm(stats.recommendedAvailableKm)}`)}
            ${previewRow("风险等级", stats.risk.label)}
            ${previewRow("计算方式", stats.calculationMethod)}
          </div>
          <p class="notice">由于缺少12个月前附近的真实里程记录，当前结果可能为保守估算。随着后续记录增加，计算会逐渐变得更准确。</p>
          <div class="button-row">
            <button class="primary-button" type="button" data-wizard-action="confirm">确认并进入首页</button>
            <button class="secondary-button" type="button" data-wizard-action="back-record">返回修改</button>
          </div>
        </div>
      </section>
    `;

    dom.app.querySelector('[data-wizard-action="confirm"]').addEventListener("click", () => {
      state.vehicleProfile = profile;
      state.records = [record];
      saveData();
      state.activeTab = "home";
      state.wizardStep = "start";
      state.wizardDraft = null;
      render();
      showToast("初始化完成。建议现在导出一次 JSON 备份。");
    });
    dom.app.querySelector('[data-wizard-action="back-record"]').addEventListener("click", () => {
      state.wizardStep = "record";
      renderWizard();
    });
  }

  function renderStepper(active) {
    return `
      <div class="stepper" aria-label="初始化进度">
        <span class="step-dot ${active >= 1 ? "active" : ""}"></span>
        <span class="step-dot ${active >= 2 ? "active" : ""}"></span>
        <span class="step-dot ${active >= 3 ? "active" : ""}"></span>
      </div>
    `;
  }

  function getActiveTabId() {
    return TABS.some((tab) => tab.id === state.activeTab) ? state.activeTab : "home";
  }

  function renderApp() {
    const profile = state.vehicleProfile;
    const stats = calculateCurrentStats();
    state.activeTab = getActiveTabId();
    dom.app.innerHTML = `
      <div class="mobile-app-shell">
        ${renderAppHeader(profile, stats)}
        <main class="app-content" data-active-tab="${escapeHtml(state.activeTab)}">
          ${renderActiveTab(profile, stats)}
        </main>
        ${renderBottomTabs()}
      </div>
    `;
    bindAppEvents();
    if (state.activeTab === "charts") {
      requestAnimationFrame(renderCharts);
    }
  }

  function renderAppHeader(profile, stats) {
    const risk = stats.risk || calculateRiskLevel(null, profile);
    return `
      <header class="app-topbar">
        <div class="topbar-title">
          <span>汉LEV里程</span>
          <strong>${escapeHtml(profile.vehicleName)}</strong>
        </div>
        <div class="topbar-status risk-${risk.className}">${escapeHtml(risk.label)}</div>
      </header>
    `;
  }

  function renderActiveTab(profile, stats) {
    if (state.activeTab === "records") {
      return renderRecordsTabHtml();
    }
    if (state.activeTab === "charts") {
      return renderChartsTabHtml(stats);
    }
    if (state.activeTab === "settings") {
      return renderSettingsTabHtml(profile);
    }
    return renderHomeTabHtml(profile, stats);
  }

  function renderBottomTabs() {
    return `
      <nav class="bottom-tabs" aria-label="主导航">
        ${TABS.map((tab) => `
          <button class="tab-button ${state.activeTab === tab.id ? "active" : ""}" type="button" data-tab="${tab.id}" aria-current="${state.activeTab === tab.id ? "page" : "false"}">
            <span>${escapeHtml(tab.label)}</span>
          </button>
        `).join("")}
      </nav>
    `;
  }

  // Tab 只改变布局，里程计算仍复用原有数据函数。
  function renderHomeTabHtml(profile, stats) {
    return `
      <section class="tab-page home-tab">
        ${renderDashboardHtml(profile, stats)}
        ${renderQuickEntryHtml()}
      </section>
    `;
  }

  function renderDashboardHtml(profile, stats) {
    const risk = stats.risk || calculateRiskLevel(null, profile);
    const recommendedMessage = Number.isFinite(stats.recommendedAvailableKm) && stats.recommendedAvailableKm < 0
      ? '<p class="dashboard-message">建议先暂停非必要用车，保留安全余量。</p>'
      : "";
    const usedText = `${formatNumber(stats.windowMileage)} / ${formatNumber(profile.limitKm)} km`;

    return `
      <section class="dashboard-panel risk-${risk.className}">
        <div class="dashboard-head">
          <p class="remaining-label">最近12个月还能跑</p>
          <span class="risk-badge">${escapeHtml(risk.label)}</span>
        </div>
        <div class="remaining-block">
          <div class="remaining-number">
            <strong>${formatNumber(stats.remainingKm)}</strong>
            <span>km</span>
          </div>
          ${recommendedMessage}
        </div>
        <div class="dashboard-facts">
          <div>
            <span>已用</span>
            <strong>${escapeHtml(usedText)}</strong>
          </div>
          <div>
            <span>建议可用</span>
            <strong>${escapeHtml(formatKm(stats.recommendedAvailableKm))}</strong>
          </div>
          <div>
            <span>状态</span>
            <strong>${escapeHtml(risk.label)}</strong>
          </div>
          <div>
            <span>计算方式</span>
            <strong>${escapeHtml(stats.calculationMethod)}</strong>
          </div>
        </div>
      </section>
    `;
  }

  function renderQuickEntryHtml() {
    const latest = sortRecords(state.records).at(-1);
    const latestText = latest
      ? `上次 ${latest.date}，${Math.round(latest.odometerKm)} km`
      : "还没有记录";
    return `
      <section class="entry-panel">
        <div class="section-head compact">
          <div>
            <h2>新增记录</h2>
            <p>${escapeHtml(latestText)}</p>
          </div>
        </div>
        <form id="quickRecordForm" class="entry-form">
          ${fieldHtml("date", "日期", "date", todayIso(), true)}
          ${fieldHtml("odometerKm", "总里程 km", "number", "", true, latest ? `上次 ${Math.round(latest.odometerKm)}` : "例如 27413")}
          <details class="note-details">
            <summary>备注</summary>
            ${textareaHtml("note", "备注", "")}
          </details>
          <button class="primary-button save-button" type="submit">保存记录</button>
        </form>
      </section>
    `;
  }

  function renderRecordsTabHtml() {
    return `
      <section class="tab-page records-tab">
        ${renderHistoryHtml()}
      </section>
    `;
  }

  function renderChartsTabHtml(stats) {
    return `
      <section class="tab-page charts-tab">
        ${renderChartsSectionHtml()}
        ${renderRiskPredictionHtml(stats)}
      </section>
    `;
  }

  function renderSettingsTabHtml(profile) {
    return `
      <section class="tab-page settings-tab">
        ${renderSettingsHtml(profile)}
        ${renderDataManagementHtml()}
        <section class="panel privacy-panel">
          <h2>隐私和备份</h2>
          <p class="notice">所有数据只保存在当前浏览器本地。换手机、清缓存或更换浏览器前，请先导出 JSON 备份。</p>
        </section>
      </section>
    `;
  }

  function renderChartsSectionHtml() {
    const averages = calculateDailyAverages();
    const historical = calculateHistoricalMaxWindow();
    const chartHint = state.records.length < 2
      ? '<div class="empty-state">至少两条记录后会形成折线趋势。</div>'
      : "";
    const historicalWindow = historical
      ? `${historical.result.startDate} 至 ${historical.result.endDate}`
      : "数据不足";

    return `
      <section class="panel" id="chartsSection">
        <div class="section-head">
          <div>
            <h2>图表</h2>
            <p>总里程与最近12个月累计里程</p>
          </div>
        </div>
        ${chartHint}
        <div class="chart-grid">
          <div class="chart-wrap">
            <h3>总里程折线图</h3>
            <canvas id="odometerChart" width="720" height="320"></canvas>
          </div>
          <div class="chart-wrap">
            <h3>最近12个月累计里程</h3>
            <canvas id="windowChart" width="720" height="320"></canvas>
          </div>
          <div class="chart-wrap">
            <h3>统计</h3>
            <div class="mini-stats">
              ${smallStatHtml("近7天日均", averageText(averages.avg7))}
              ${smallStatHtml("近30天日均", averageText(averages.avg30))}
              ${smallStatHtml("近90天日均", averageText(averages.avg90))}
              ${smallStatHtml("历史最大12个月", historical ? formatKm(historical.result.windowMileage) : "数据不足")}
              ${smallStatHtml("最大窗口", historicalWindow)}
            </div>
          </div>
        </div>
      </section>
    `;
  }

  function renderHistoryHtml() {
    const sorted = sortRecords(state.records);
    const reversed = [...sorted].reverse();
    const recordsHtml = reversed.length ? reversed.map((record) => {
      const index = sorted.findIndex((item) => item.id === record.id);
      const previous = index > 0 ? sorted[index - 1] : null;
      const delta = previous ? record.odometerKm - previous.odometerKm : null;
      return `
        <article class="record-card">
          <div class="record-main">
            <div class="record-copy">
              <span class="record-date">${escapeHtml(record.date)}</span>
              <strong>${formatKm(record.odometerKm)}</strong>
              <span class="record-delta">较上次 ${delta === null ? "-" : `+${formatKm(delta)}`}</span>
            </div>
            <div class="record-actions">
              <button class="icon-button" type="button" data-action="edit-record" data-id="${escapeHtml(record.id)}">编辑</button>
              <button class="danger-button" type="button" data-action="delete-record" data-id="${escapeHtml(record.id)}">删除</button>
            </div>
          </div>
          ${record.note ? `<p class="record-note">${escapeHtml(record.note)}</p>` : ""}
        </article>
      `;
    }).join("") : '<div class="empty-state">暂无记录</div>';

    return `
      <section class="panel" id="historySection">
        <div class="section-head">
          <div>
            <h2>记录</h2>
            <p>最近记录按日期倒序排列</p>
          </div>
        </div>
        <div class="history-list">
          ${recordsHtml}
        </div>
      </section>
    `;
  }

  function renderRiskPredictionHtml(stats) {
    const profile = state.vehicleProfile;
    const averages = calculateDailyAverages();
    const avg30 = averages.avg30 ? averages.avg30.value : null;
    const predictions = [
      { label: "到预警线", threshold: profile.warningKm },
      { label: "到高风险线", threshold: profile.highRiskKm },
      { label: "到厂家上限", threshold: profile.limitKm }
    ];

    return `
      <section class="panel">
        <div class="section-head">
          <div>
            <h2>风险预测</h2>
            <p>按最近30天日均里程估算。</p>
          </div>
        </div>
        <div class="prediction-grid">
          ${smallStatHtml("最近7天日均", averageText(averages.avg7))}
          ${smallStatHtml("最近30天日均", averageText(averages.avg30))}
          ${smallStatHtml("最近90天日均", averageText(averages.avg90))}
          ${smallStatHtml("自首条以来日均", averageText(averages.allTime))}
          ${predictions.map((item) => smallStatHtml(item.label, projectionText(stats.windowMileage, item.threshold, avg30))).join("")}
        </div>
      </section>
    `;
  }

  function renderDataManagementHtml() {
    return `
      <section class="panel">
        <div class="section-head">
          <div>
            <h2>数据管理</h2>
            <p>备份、恢复和导出</p>
          </div>
        </div>
        <div class="data-actions">
          <button class="primary-button" type="button" data-action="export-json">导出 JSON 备份</button>
          <button class="secondary-button" type="button" data-action="import-json">导入 JSON 恢复</button>
          <button class="secondary-button" type="button" data-action="export-csv">导出 CSV</button>
          <button class="secondary-button" type="button" data-action="export-md">导出 Markdown</button>
          <button class="secondary-button" type="button" data-action="install-app">添加到手机桌面</button>
        </div>
      </section>
    `;
  }

  function renderSettingsHtml(profile) {
    return `
      <form id="settingsForm" class="settings-form">
        <section class="panel">
          <div class="section-head">
            <div>
              <h2>车辆档案</h2>
              <p>车辆和购车信息</p>
            </div>
          </div>
          <div class="grid-form settings-grid">
            ${fieldHtml("vehicleName", "车辆名称", "text", profile.vehicleName, true)}
            ${fieldHtml("purchaseDateText", "购车时间", "text", profile.purchaseDateText, false)}
            ${fieldHtml("purchaseOdometerKm", "购车时里程 km", "number", profile.purchaseOdometerKm, false)}
            ${fieldHtml("modelVersion", "车型配置", "text", profile.modelVersion, false)}
            ${fieldHtml("plateNumber", "车牌号", "text", profile.plateNumber, false)}
          </div>
        </section>
        <section class="panel">
          <div class="section-head">
            <div>
              <h2>里程规则</h2>
              <p>12个月窗口、预警线和安全余量</p>
            </div>
          </div>
          <div class="grid-form settings-grid">
            ${fieldHtml("limitKm", "12个月上限 km", "number", profile.limitKm, true)}
            ${fieldHtml("warningKm", "预警线 km", "number", profile.warningKm, true)}
            ${fieldHtml("highRiskKm", "高风险线 km", "number", profile.highRiskKm, true)}
            ${fieldHtml("safetyBufferKm", "安全余量 km", "number", profile.safetyBufferKm, true)}
            ${textareaHtml("warrantyNote", "保险/质保备注", profile.warrantyNote)}
            ${textareaHtml("otherNote", "其他备注", profile.otherNote)}
          </div>
        </section>
        <button class="primary-button save-button" type="submit">保存设置</button>
        </form>
    `;
  }

  function bindAppEvents() {
    const quickRecordForm = dom.app.querySelector("#quickRecordForm");
    if (quickRecordForm) {
      quickRecordForm.addEventListener("submit", handleQuickRecordSubmit);
    }

    const settingsForm = dom.app.querySelector("#settingsForm");
    if (settingsForm) {
      settingsForm.addEventListener("submit", handleSettingsSubmit);
    }

    dom.app.querySelectorAll("[data-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        state.activeTab = button.dataset.tab;
        render();
      });
    });

    dom.app.querySelectorAll("[data-action]").forEach((button) => {
      button.addEventListener("click", handleActionClick);
    });
  }

  function handleQuickRecordSubmit(event) {
    event.preventDefault();
    try {
      const form = event.currentTarget;
      const result = addRecord({
        date: form.elements.date.value,
        odometerKm: form.elements.odometerKm.value,
        note: form.elements.note.value
      });
      if (result.saved) {
        render();
      }
      showToast(result.message);
    } catch (error) {
      showToast(error.message);
    }
  }

  function handleSettingsSubmit(event) {
    event.preventDefault();
    try {
      state.vehicleProfile = vehicleProfileFromForm(event.currentTarget, state.vehicleProfile);
      state.vehicleProfile.updatedAt = new Date().toISOString();
      saveData();
      render();
      showToast("设置已保存，统计已更新。");
    } catch (error) {
      showToast(error.message);
    }
  }

  function handleActionClick(event) {
    const button = event.currentTarget;
    const action = button.dataset.action;
    const id = button.dataset.id;

    try {
      if (action === "edit-record") {
        openRecordEditor(id);
      } else if (action === "delete-record") {
        deleteRecord(id);
      } else if (action === "export-json") {
        exportJson();
      } else if (action === "import-json") {
        state.importMode = "app";
        dom.importInput.value = "";
        dom.importInput.click();
      } else if (action === "export-csv") {
        exportCsv();
      } else if (action === "export-md") {
        exportMarkdown();
      } else if (action === "install-app") {
        handleInstallApp();
      }
    } catch (error) {
      showToast(error.message);
    }
  }

  function openRecordEditor(id) {
    const record = state.records.find((item) => item.id === id);
    if (!record) {
      showToast("未找到这条记录。");
      return;
    }

    openModal(`
      <h2>编辑记录</h2>
      <form id="editRecordForm" class="grid-form">
        ${fieldHtml("date", "日期", "date", record.date, true)}
        ${fieldHtml("odometerKm", "总里程 km", "number", record.odometerKm, true)}
        ${textareaHtml("note", "备注", record.note)}
        <div class="button-row">
          <button class="primary-button" type="submit">保存修改</button>
          <button class="secondary-button" type="button" data-modal-close>取消</button>
        </div>
      </form>
    `);

    document.getElementById("editRecordForm").addEventListener("submit", (event) => {
      event.preventDefault();
      try {
        const form = event.currentTarget;
        const result = updateRecord(id, {
          date: form.elements.date.value,
          odometerKm: form.elements.odometerKm.value,
          note: form.elements.note.value
        });
        closeModal();
        if (result.saved) {
          render();
        }
        showToast(result.message);
      } catch (error) {
        showToast(error.message);
      }
    });
  }

  function vehicleProfileFromForm(form, previousProfile) {
    const previous = previousProfile || createDefaultProfile();
    const purchase = parsePurchaseDate(form.elements.purchaseDateText.value);
    const profile = {
      ...previous,
      vehicleName: form.elements.vehicleName.value.trim(),
      limitKm: Number(form.elements.limitKm.value),
      warningKm: Number(form.elements.warningKm.value),
      highRiskKm: Number(form.elements.highRiskKm.value),
      safetyBufferKm: Number(form.elements.safetyBufferKm.value),
      purchaseDateText: form.elements.purchaseDateText.value.trim(),
      purchaseDateForCalc: purchase.dateForCalc,
      purchaseDatePrecision: purchase.precision,
      purchaseOdometerKm: form.elements.purchaseOdometerKm.value === "" ? 0 : Number(form.elements.purchaseOdometerKm.value),
      modelVersion: form.elements.modelVersion.value.trim(),
      plateNumber: form.elements.plateNumber.value.trim(),
      warrantyNote: form.elements.warrantyNote.value.trim(),
      otherNote: form.elements.otherNote.value.trim(),
      updatedAt: new Date().toISOString()
    };

    if (!profile.vehicleName) {
      throw new Error("车辆名称不能为空。");
    }
    if (!Number.isFinite(profile.limitKm) || profile.limitKm <= 0) {
      throw new Error("12个月上限必须大于0。");
    }
    if (!Number.isFinite(profile.warningKm) || profile.warningKm <= 0) {
      throw new Error("预警线必须大于0。");
    }
    if (!Number.isFinite(profile.highRiskKm) || profile.highRiskKm <= 0) {
      throw new Error("高风险线必须大于0。");
    }
    if (!Number.isFinite(profile.safetyBufferKm) || profile.safetyBufferKm < 0) {
      throw new Error("安全余量不能小于0。");
    }
    if (!Number.isFinite(profile.purchaseOdometerKm) || profile.purchaseOdometerKm < 0) {
      throw new Error("购车时里程不能小于0。");
    }
    if (!(profile.warningKm < profile.highRiskKm && profile.highRiskKm < profile.limitKm)) {
      throw new Error("请保持：预警线 < 高风险线 < 12个月上限。");
    }

    return profile;
  }

  async function handleImportFile(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      if (hasUsableData() && state.importMode === "app") {
        const ok = window.confirm("导入 JSON 会替换当前本机数据。请确认你已经导出现有备份，是否继续？");
        if (!ok) {
          return;
        }
      }
      const result = importJson(text);
      state.vehicleProfile = result.vehicleProfile;
      state.records = result.records;
      saveData();
      state.activeTab = "home";
      state.wizardStep = "start";
      state.wizardDraft = null;
      render();
      const latest = sortRecords(state.records).at(-1);
      const warningText = result.warnings.length ? ` 提醒：${result.warnings.join("；")}` : "";
      showToast(`导入成功：${state.vehicleProfile.vehicleName}，${state.records.length} 条记录，最近 ${latest.date} ${latest.odometerKm} km。${warningText}`);
    } catch (error) {
      showToast(`导入失败：${error.message}`);
    } finally {
      event.target.value = "";
    }
  }

  function importJson(text) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new Error("JSON 格式不正确，请确认选择的是之前导出的 .json 文件。");
    }

    const result = validateBackup(parsed);
    if (result.errors.length) {
      throw new Error(result.errors.join("；"));
    }
    return result;
  }

  function validateBackup(parsed) {
    const errors = [];
    const warnings = [];

    if (!parsed || typeof parsed !== "object") {
      return { errors: ["JSON 顶层必须是对象。"], warnings, vehicleProfile: null, records: [] };
    }
    if (!parsed.vehicleProfile || typeof parsed.vehicleProfile !== "object") {
      errors.push("缺少 vehicleProfile。");
    }
    if (!Array.isArray(parsed.records)) {
      errors.push("缺少 records 数组。");
    }
    if (errors.length) {
      return { errors, warnings, vehicleProfile: null, records: [] };
    }

    const profile = normalizeVehicleProfile(parsed.vehicleProfile);
    if (!profile.vehicleName) {
      errors.push("车辆名称不能为空。");
    }
    if (!(profile.warningKm < profile.highRiskKm && profile.highRiskKm < profile.limitKm)) {
      errors.push("车辆档案中的预警线、高风险线和上限设置不合理。");
    }

    const byDate = new Map();
    parsed.records.forEach((raw, index) => {
      if (!raw || typeof raw !== "object") {
        errors.push(`第 ${index + 1} 条记录不是对象。`);
        return;
      }
      if (!isValidDateString(raw.date)) {
        errors.push(`第 ${index + 1} 条记录日期不正确。`);
        return;
      }
      const odometerKm = Number(raw.odometerKm);
      if (!Number.isFinite(odometerKm) || odometerKm < 0) {
        errors.push(`${raw.date} 的总里程必须是非负数字。`);
        return;
      }
      const record = {
        id: raw.id || createId(),
        date: raw.date,
        odometerKm,
        note: String(raw.note || ""),
        createdAt: raw.createdAt || new Date().toISOString(),
        updatedAt: raw.updatedAt || raw.createdAt || new Date().toISOString()
      };
      const existing = byDate.get(record.date);
      if (!existing || String(record.updatedAt) >= String(existing.updatedAt)) {
        byDate.set(record.date, record);
      }
      if (existing) {
        warnings.push(`${record.date} 有重复记录，已保留 updatedAt 较新的那条。`);
      }
    });

    const records = sortRecords([...byDate.values()]);
    if (!records.length) {
      errors.push("records 为空，至少需要一条里程记录。");
    }

    for (let index = 1; index < records.length; index += 1) {
      if (records[index].odometerKm < records[index - 1].odometerKm) {
        errors.push(`${records[index].date} 的总里程小于前一条记录，导入会造成里程倒退。`);
      }
      const jump = records[index].odometerKm - records[index - 1].odometerKm;
      if (jump > LARGE_JUMP_KM) {
        warnings.push(`${records[index - 1].date} 到 ${records[index].date} 增加 ${jump} km，建议导入后核对。`);
      }
    }

    return { errors, warnings, vehicleProfile: profile, records };
  }

  function exportJson() {
    const payload = {
      appVersion: APP_VERSION,
      exportedAt: new Date().toISOString(),
      vehicleProfile: state.vehicleProfile,
      records: sortRecords(state.records)
    };
    downloadFile(`byd-mileage-backup-${todayIso()}.json`, JSON.stringify(payload, null, 2), "application/json;charset=utf-8");
    showToast("JSON 备份文件已生成。");
  }

  function exportCsv() {
    const header = ["date", "odometerKm", "note", "createdAt", "updatedAt"];
    const lines = [header.join(",")];
    sortRecords(state.records).forEach((record) => {
      lines.push([
        record.date,
        record.odometerKm,
        record.note,
        record.createdAt,
        record.updatedAt
      ].map(csvEscape).join(","));
    });
    downloadFile(`byd-mileage-records-${todayIso()}.csv`, "\ufeff" + lines.join("\n"), "text/csv;charset=utf-8");
    showToast("CSV 文件已生成，可用 Excel 打开。");
  }

  function exportMarkdown() {
    const markdown = buildMarkdown();
    downloadFile(`byd-mileage-report-${todayIso()}.md`, markdown, "text/markdown;charset=utf-8");
    showToast("Markdown 文件已生成，可发给 GPT 或自己归档。");
  }

  function buildMarkdown() {
    const profile = state.vehicleProfile;
    const stats = calculateCurrentStats();
    const sorted = sortRecords(state.records);
    const rows = sorted.map((record, index) => {
      const previous = index > 0 ? sorted[index - 1] : null;
      const delta = previous ? record.odometerKm - previous.odometerKm : "-";
      return `| ${record.date} | ${Math.round(record.odometerKm)} | ${delta} | ${escapeMarkdownCell(record.note)} |`;
    }).join("\n");

    return `# ${profile.vehicleName}里程记录

规则：任意连续12个月累计里程不超过 ${Math.round(profile.limitKm)} km。

## 车辆档案

- 车辆名称：${profile.vehicleName}
- 购车时间：${profile.purchaseDateText || "未填写"}
- 12个月上限：${Math.round(profile.limitKm)} km
- 安全余量：${Math.round(profile.safetyBufferKm)} km

## 当前概况

- 最近记录日期：${stats.latest ? stats.latest.date : "无"}
- 当前总里程：${stats.latest ? Math.round(stats.latest.odometerKm) + " km" : "无"}
- 最近12个月估算已用：${formatKm(stats.windowMileage)}
- 剩余额度：${formatKm(stats.remainingKm)}
- 风险等级：${stats.risk.label}
- 计算方式：${stats.calculationMethod}

## 里程记录

| 日期 | 总里程 km | 较上次增加 km | 备注 |
|---|---:|---:|---|
${rows}
`;
  }

  function downloadFile(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function handleInstallApp() {
    if (state.deferredInstallPrompt) {
      state.deferredInstallPrompt.prompt();
      state.deferredInstallPrompt.userChoice.finally(() => {
        state.deferredInstallPrompt = null;
      });
      return;
    }

    openModal(`
      <h2>添加到手机桌面</h2>
      <p class="install-tip">如果浏览器没有弹出安装按钮，请用浏览器菜单操作。</p>
      <p>华为手机常见路径：打开本页面后，点浏览器右上角或底部菜单，选择“添加至桌面”“添加到主屏幕”或“安装应用”。</p>
      <p>如果菜单里没有安装选项，请先用本地服务或 GitHub Pages 打开本页面，不要直接用文件管理器打开 HTML。</p>
      <div class="button-row">
        <button class="primary-button" type="button" data-modal-close>知道了</button>
      </div>
    `);
  }

  function renderCharts() {
    const records = sortRecords(state.records);
    const profile = state.vehicleProfile;
    const odometerPoints = records.length >= 2 ? records.map((record) => ({
      date: record.date,
      value: record.odometerKm
    })) : [];
    const windowPoints = records
      .map((record) => {
        const result = calculateWindowMileage(record, records, profile);
        return Number.isFinite(result.windowMileage)
          ? { date: record.date, value: result.windowMileage }
          : null;
      })
      .filter(Boolean);

    drawLineChart(document.getElementById("odometerChart"), odometerPoints, {
      lineColor: "#0f766e",
      valueSuffix: "km",
      emptyText: "继续添加记录后显示总里程趋势"
    });
    drawLineChart(document.getElementById("windowChart"), windowPoints, {
      lineColor: "#c2410c",
      valueSuffix: "km",
      emptyText: "数据不足，继续记录后显示12个月窗口",
      references: [
        { value: Math.max(0, profile.warningKm - 2000), label: "注意线", color: "#a16207" },
        { value: profile.warningKm, label: "预警线", color: "#c2410c" },
        { value: profile.highRiskKm, label: "高风险", color: "#b91c1c" },
        { value: profile.limitKm, label: "上限", color: "#7f1d1d" }
      ]
    });
  }

  function drawLineChart(canvas, points, options) {
    if (!canvas) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const width = Math.max(280, Math.floor(rect.width || canvas.width));
    const height = Math.max(220, Math.floor(rect.height || canvas.height));
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const context = canvas.getContext("2d");
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);

    if (!points.length) {
      context.fillStyle = "#64706d";
      context.font = "14px Microsoft YaHei, sans-serif";
      context.textAlign = "center";
      context.fillText(options.emptyText || "数据不足", width / 2, height / 2);
      return;
    }

    const margin = { top: 20, right: 18, bottom: 42, left: 50 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const xValues = points.map((point) => dateToTime(point.date));
    const yValues = points.map((point) => point.value);
    const references = options.references || [];
    const referenceValues = references.map((item) => item.value);
    let minX = Math.min(...xValues);
    let maxX = Math.max(...xValues);
    if (minX === maxX) {
      minX -= MS_PER_DAY;
      maxX += MS_PER_DAY;
    }
    let minY = Math.min(0, ...yValues);
    let maxY = Math.max(...yValues, ...referenceValues, 1);
    const yPadding = Math.max(100, (maxY - minY) * 0.08);
    maxY += yPadding;

    const xScale = (value) => margin.left + ((value - minX) / (maxX - minX)) * plotWidth;
    const yScale = (value) => margin.top + plotHeight - ((value - minY) / (maxY - minY)) * plotHeight;

    context.strokeStyle = "#dbe2df";
    context.lineWidth = 1;
    context.fillStyle = "#64706d";
    context.font = "12px Microsoft YaHei, sans-serif";
    context.textAlign = "right";
    context.textBaseline = "middle";
    for (let step = 0; step <= 4; step += 1) {
      const y = margin.top + (plotHeight / 4) * step;
      const value = maxY - ((maxY - minY) / 4) * step;
      context.beginPath();
      context.moveTo(margin.left, y);
      context.lineTo(width - margin.right, y);
      context.stroke();
      context.fillText(Math.round(value).toString(), margin.left - 8, y);
    }

    const referenceLabels = references
      .map((reference) => ({ ...reference, y: yScale(reference.value), labelY: yScale(reference.value) }))
      .sort((a, b) => a.y - b.y);
    for (let index = 1; index < referenceLabels.length; index += 1) {
      referenceLabels[index].labelY = Math.max(referenceLabels[index].labelY, referenceLabels[index - 1].labelY + 17);
    }
    const labelBottom = margin.top + plotHeight - 8;
    const overflow = referenceLabels.length ? referenceLabels.at(-1).labelY - labelBottom : 0;
    if (overflow > 0) {
      referenceLabels.forEach((reference) => {
        reference.labelY -= overflow;
      });
    }
    const labelTop = margin.top + 8;
    const underflow = referenceLabels.length ? labelTop - referenceLabels[0].labelY : 0;
    if (underflow > 0) {
      referenceLabels.forEach((reference) => {
        reference.labelY += underflow;
      });
    }

    referenceLabels.forEach((reference) => {
      const y = reference.y;
      context.save();
      context.setLineDash([5, 5]);
      context.strokeStyle = reference.color;
      context.beginPath();
      context.moveTo(margin.left, y);
      context.lineTo(width - margin.right, y);
      context.stroke();
      context.restore();
      context.fillStyle = reference.color;
      context.textAlign = "right";
      context.textBaseline = "middle";
      context.fillText(reference.label, width - margin.right - 4, reference.labelY);
    });

    context.strokeStyle = options.lineColor || "#0f766e";
    context.lineWidth = 3;
    context.beginPath();
    points.forEach((point, index) => {
      const x = xScale(dateToTime(point.date));
      const y = yScale(point.value);
      if (index === 0) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
    });
    context.stroke();

    context.fillStyle = options.lineColor || "#0f766e";
    points.forEach((point) => {
      const x = xScale(dateToTime(point.date));
      const y = yScale(point.value);
      context.beginPath();
      context.arc(x, y, 4, 0, Math.PI * 2);
      context.fill();
    });

    context.fillStyle = "#64706d";
    context.textAlign = "left";
    context.textBaseline = "top";
    context.fillText(points[0].date, margin.left, height - 30);
    context.textAlign = "right";
    context.fillText(points.at(-1).date, width - margin.right, height - 30);
  }

  function seedExampleData() {
    const now = new Date().toISOString();
    const profile = createDefaultProfile();
    state.vehicleProfile = {
      ...profile,
      createdAt: now,
      updatedAt: now
    };
    state.records = [{
      id: createId(),
      date: "2026-07-08",
      odometerKm: 27413,
      note: "第一条基准记录",
      createdAt: now,
      updatedAt: now
    }];
    saveData();
  }

  function fieldHtml(name, label, type, value, required, placeholder = "") {
    const inputMode = type === "number" ? ' inputmode="numeric" min="0" step="1"' : "";
    return `
      <div class="field">
        <label for="${escapeHtml(name)}">${escapeHtml(label)}</label>
        <input id="${escapeHtml(name)}" name="${escapeHtml(name)}" type="${escapeHtml(type)}" value="${escapeHtml(value)}"${required ? " required" : ""}${placeholder ? ` placeholder="${escapeHtml(placeholder)}"` : ""}${inputMode}>
      </div>
    `;
  }

  function textareaHtml(name, label, value) {
    return `
      <div class="field full">
        <label for="${escapeHtml(name)}">${escapeHtml(label)}</label>
        <textarea id="${escapeHtml(name)}" name="${escapeHtml(name)}">${escapeHtml(value)}</textarea>
      </div>
    `;
  }

  function metricHtml(label, value) {
    return `
      <div class="metric">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value)}</strong>
      </div>
    `;
  }

  function smallStatHtml(label, value) {
    return `
      <div class="stat-box">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value)}</strong>
      </div>
    `;
  }

  function previewRow(label, value) {
    return `
      <div class="preview-row">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value)}</strong>
      </div>
    `;
  }

  function averageText(average) {
    return average ? `${Math.round(average.value)} km/天` : "数据不足";
  }

  function projectionText(currentWindowMileage, threshold, averagePerDay) {
    if (!Number.isFinite(currentWindowMileage) || !Number.isFinite(averagePerDay) || averagePerDay <= 0) {
      return "数据不足";
    }
    if (currentWindowMileage >= threshold) {
      return "已达到";
    }
    return `约 ${Math.ceil((threshold - currentWindowMileage) / averagePerDay)} 天`;
  }

  function formatKm(value) {
    if (!Number.isFinite(value)) {
      return "数据不足";
    }
    return `${Math.round(value)} km`;
  }

  function formatNumber(value) {
    if (!Number.isFinite(value)) {
      return "—";
    }
    return Math.round(value).toLocaleString("zh-CN");
  }

  function csvEscape(value) {
    const text = String(value == null ? "" : value);
    if (/[",\n]/.test(text)) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  }

  function escapeMarkdownCell(value) {
    return String(value || "").replace(/\|/g, "\\|").replace(/\n/g, " ");
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function showToast(message) {
    dom.toast.textContent = message;
    dom.toast.classList.add("show");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => {
      dom.toast.classList.remove("show");
    }, 3600);
  }

  function openModal(html) {
    closeModal();
    const wrapper = document.createElement("div");
    wrapper.className = "modal-backdrop";
    wrapper.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
    wrapper.addEventListener("click", (event) => {
      if (event.target === wrapper || event.target.hasAttribute("data-modal-close")) {
        closeModal();
      }
    });
    document.body.appendChild(wrapper);
  }

  function closeModal() {
    const existing = document.querySelector(".modal-backdrop");
    if (existing) {
      existing.remove();
    }
  }

  function debounce(fn, wait) {
    let timer = null;
    return function debounced(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  window.__BYD_MILEAGE_TEST__ = {
    subtractMonths,
    estimateOdometerAtDate,
    calculateWindowMileage,
    calculateRiskLevel,
    calculateDailyAverages,
    importJson,
    buildMarkdown
  };
})();
