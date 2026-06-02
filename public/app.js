const {
  useEffect,
  useMemo,
  useState
} = React;
const fallbackSettings = {
  markupMultiplier: 2.25,
  defaultTaxRate: 0,
  glassSpecs: [{
    id: "clear",
    name: "Clear",
    pricePerSqFt: 0
  }, {
    id: "lowe",
    name: "LowE",
    pricePerSqFt: 2
  }, {
    id: "tempered",
    name: "Tempered",
    pricePerSqFt: 5
  }, {
    id: "annealed",
    name: "Annealed",
    pricePerSqFt: 1.25
  }, {
    id: "colored-spacer",
    name: "Colored Spacer",
    pricePerSqFt: 0.75
  }, {
    id: "argon",
    name: "Argon",
    pricePerSqFt: 1.5
  }, {
    id: "pattern",
    name: "Pattern",
    pricePerSqFt: 3
  }, {
    id: "eighth-over-eighth",
    name: "1/8 over 1/8",
    pricePerSqFt: 2.5
  }, {
    id: "sixteenth-over-sixteenth",
    name: "1/16 over 1/16",
    pricePerSqFt: 1.75
  }],
  addOns: [{
    id: "logistics",
    name: "Logistics",
    cost: 85,
    costType: "flat"
  }, {
    id: "disposal",
    name: "Disposal",
    cost: 12,
    costType: "per_item"
  }],
  labor: {
    hourly: {
      enabled: true,
      rate: 95
    },
    perSquareFoot: {
      enabled: true,
      rate: 4.5
    },
    flatFee: {
      enabled: true,
      fee: 175
    }
  }
};
const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD"
});
const numberFormat = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 0
});
const costTypeLabels = {
  flat: "Flat fee",
  per_sq_ft: "Per square foot",
  per_item: "Per item/quantity"
};
function money(value) {
  return currency.format(Number.isFinite(value) ? value : 0);
}
function measurement(value) {
  return numberFormat.format(Number.isFinite(value) ? value : 0);
}
function positive(value) {
  return Number(value) > 0;
}
function parseFractionalInches(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : Number.NaN;
  }
  const raw = value.trim();
  if (!raw || raw.startsWith("-")) return Number.NaN;
  const normalized = raw.replace(/"/g, "").replace(/\s*\/\s*/g, "/").replace(/(\d)-(?=\d)/g, "$1 ").replace(/\s+/g, " ");
  const directNumber = Number(normalized);
  if (Number.isFinite(directNumber)) return directNumber;
  return normalized.split(" ").reduce((total, part) => {
    if (!part) return total;
    if (part.includes("/")) {
      const pieces = part.split("/");
      if (pieces.length !== 2) return Number.NaN;
      const numerator = Number(pieces[0]);
      const denominator = Number(pieces[1]);
      if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
        return Number.NaN;
      }
      return total + numerator / denominator;
    }
    const numberPart = Number(part);
    return Number.isFinite(numberPart) ? total + numberPart : Number.NaN;
  }, 0);
}
function makeId(prefix) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.round(Math.random() * 100000)}`;
}
function cloneSettings(settings) {
  return JSON.parse(JSON.stringify(settings));
}
function slugify(value, fallback) {
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || fallback;
}
function normalizeNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
}
function formatDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}
function specNames(line, settings) {
  const names = settings.glassSpecs.filter(spec => line.specIds.includes(spec.id)).map(spec => spec.name);
  return names.length ? names.join(", ") : "No specs selected";
}
function squareFeet(width, height) {
  return width * height / 144;
}
function specPricePerSqFt(line, settings) {
  return settings.glassSpecs.reduce((total, spec) => {
    return line.specIds.includes(spec.id) ? total + spec.pricePerSqFt : total;
  }, 0);
}
function calculateLine(line, settings) {
  const unitSqFt = squareFeet(line.width, line.height);
  const totalSqFt = unitSqFt * line.quantity;
  const pricePerSqFt = specPricePerSqFt(line, settings);
  const subtotal = totalSqFt * pricePerSqFt;
  return {
    unitSqFt,
    totalSqFt,
    pricePerSqFt,
    subtotal
  };
}
function calculateAddOn(addOn, totalSqFt, totalQuantity) {
  if (addOn.costType === "per_sq_ft") {
    return {
      addOn,
      total: addOn.cost * totalSqFt,
      basis: `${money(addOn.cost)} x ${measurement(totalSqFt)} sq ft`
    };
  }
  if (addOn.costType === "per_item") {
    return {
      addOn,
      total: addOn.cost * totalQuantity,
      basis: `${money(addOn.cost)} x ${measurement(totalQuantity)} items`
    };
  }
  return {
    addOn,
    total: addOn.cost,
    basis: "Flat fee"
  };
}
async function responseJson(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Request failed.");
  }
  return data;
}
function App() {
  const [activeView, setActiveView] = useState("estimate");
  const [authUser, setAuthUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [settings, setSettings] = useState(fallbackSettings);
  const [adminSettings, setAdminSettings] = useState(cloneSettings(fallbackSettings));
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [adminStatus, setAdminStatus] = useState("idle");
  const [adminMessage, setAdminMessage] = useState("");
  const [draftLine, setDraftLine] = useState({
    width: "",
    height: "",
    quantity: "1",
    specIds: ["clear"]
  });
  const [lineError, setLineError] = useState("");
  const [estimateLines, setEstimateLines] = useState([]);
  const [selectedAddOns, setSelectedAddOns] = useState([]);
  const [laborSelection, setLaborSelection] = useState({
    useHours: false,
    hours: "",
    useSquareFoot: false,
    useFlatFee: false
  });
  const [taxEnabled, setTaxEnabled] = useState(false);
  const [taxRate, setTaxRate] = useState("0");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [users, setUsers] = useState([]);
  const [teamStatus, setTeamStatus] = useState("");
  const [teamError, setTeamError] = useState("");
  const [teamDraft, setTeamDraft] = useState({
    name: "",
    email: "",
    password: "",
    role: "team_member"
  });
  const [estimates, setEstimates] = useState([]);
  const [estimateName, setEstimateName] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const [saveError, setSaveError] = useState("");
  const isAdmin = authUser?.role === "admin";
  async function apiRequest(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      credentials: "same-origin",
      headers: {
        ...(options.body ? {
          "Content-Type": "application/json"
        } : {}),
        ...(options.headers || {})
      }
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 && path !== "/api/session") {
      setAuthUser(null);
      setActiveView("estimate");
    }
    if (!response.ok) {
      throw new Error(data.error || "Request failed.");
    }
    return data;
  }
  async function refreshSettings() {
    const data = await apiRequest("/api/settings");
    setSettings(data);
    setAdminSettings(cloneSettings(data));
    setTaxRate(String(data.defaultTaxRate ?? 0));
  }
  async function refreshEstimates() {
    const data = await apiRequest("/api/estimates");
    setEstimates(data.estimates || []);
  }
  async function refreshUsers() {
    const data = await apiRequest("/api/users");
    setUsers(data.users || []);
  }
  async function loadAuthorizedData(user) {
    setLoading(true);
    setLoadError("");
    try {
      await Promise.all([refreshSettings(), refreshEstimates(), user.role === "admin" ? refreshUsers() : Promise.resolve()]);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not load secure app data.");
    } finally {
      setLoading(false);
    }
  }
  async function checkSession() {
    try {
      const response = await fetch("/api/session", {
        credentials: "same-origin"
      });
      if (!response.ok) {
        setAuthUser(null);
        setLoading(false);
        return;
      }
      const data = await responseJson(response);
      setAuthUser(data.user);
      await loadAuthorizedData(data.user);
    } catch {
      setAuthUser(null);
      setLoading(false);
    } finally {
      setAuthLoading(false);
    }
  }
  useEffect(() => {
    checkSession();
  }, []);
  useEffect(() => {
    if (!isAdmin && (activeView === "admin" || activeView === "team")) {
      setActiveView("estimate");
    }
  }, [activeView, isAdmin]);
  async function login(event) {
    event.preventDefault();
    setLoginLoading(true);
    setLoginError("");
    try {
      const data = await apiRequest("/api/login", {
        method: "POST",
        body: JSON.stringify({
          email: loginEmail,
          password: loginPassword
        })
      });
      setAuthUser(data.user);
      setLoginPassword("");
      await loadAuthorizedData(data.user);
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : "Unable to sign in.");
    } finally {
      setLoginLoading(false);
    }
  }
  async function logout() {
    await apiRequest("/api/logout", {
      method: "POST"
    }).catch(() => null);
    setAuthUser(null);
    setUsers([]);
    setEstimates([]);
    setEstimateLines([]);
    setSelectedAddOns([]);
    setActiveView("estimate");
  }
  const totals = useMemo(() => {
    const lineCalculations = estimateLines.map(line => ({
      line,
      ...calculateLine(line, settings)
    }));
    const totalSqFt = lineCalculations.reduce((total, line) => total + line.totalSqFt, 0);
    const totalQuantity = estimateLines.reduce((total, line) => total + line.quantity, 0);
    const glassSubtotal = lineCalculations.reduce((total, line) => total + line.subtotal, 0);
    const glassTotalWithMarkup = glassSubtotal * settings.markupMultiplier;
    const addOnTotals = settings.addOns.filter(addOn => selectedAddOns.includes(addOn.id)).map(addOn => calculateAddOn(addOn, totalSqFt, totalQuantity));
    const addOnsTotal = addOnTotals.reduce((total, item) => total + item.total, 0);
    const hours = normalizeNumber(laborSelection.hours);
    const laborRows = [laborSelection.useHours && settings.labor.hourly.enabled ? {
      label: "Labor by hours",
      basis: `${measurement(hours)} hrs x ${money(settings.labor.hourly.rate)}/hr`,
      total: hours * settings.labor.hourly.rate
    } : null, laborSelection.useSquareFoot && settings.labor.perSquareFoot.enabled ? {
      label: "Labor by square footage",
      basis: `${measurement(totalSqFt)} sq ft x ${money(settings.labor.perSquareFoot.rate)}/sq ft`,
      total: totalSqFt * settings.labor.perSquareFoot.rate
    } : null, laborSelection.useFlatFee && settings.labor.flatFee.enabled ? {
      label: "Labor flat fee",
      basis: "Flat labor fee",
      total: settings.labor.flatFee.fee
    } : null].filter(Boolean);
    const laborTotal = laborRows.reduce((total, row) => total + row.total, 0);
    const preTaxTotal = glassTotalWithMarkup + addOnsTotal + laborTotal;
    const taxAmount = taxEnabled ? preTaxTotal * (normalizeNumber(taxRate) / 100) : 0;
    const grandTotal = preTaxTotal + taxAmount;
    return {
      lineCalculations,
      totalSqFt,
      totalQuantity,
      glassSubtotal,
      glassTotalWithMarkup,
      addOnTotals,
      addOnsTotal,
      laborRows,
      laborTotal,
      preTaxTotal,
      taxAmount,
      grandTotal
    };
  }, [estimateLines, laborSelection, selectedAddOns, settings, taxEnabled, taxRate]);
  function updateDraft(field, value) {
    setDraftLine(current => ({
      ...current,
      [field]: value
    }));
    setLineError("");
  }
  function toggleDraftSpec(specId) {
    setDraftLine(current => {
      const specIds = current.specIds.includes(specId) ? current.specIds.filter(id => id !== specId) : [...current.specIds, specId];
      return {
        ...current,
        specIds
      };
    });
  }
  function addLine() {
    const width = parseFractionalInches(draftLine.width);
    const height = parseFractionalInches(draftLine.height);
    const quantity = Number(draftLine.quantity);
    if (!(width > 0) || !(height > 0) || !(quantity > 0)) {
      setLineError("Width, height, and quantity must be positive values.");
      return;
    }
    setEstimateLines(current => [...current, {
      id: makeId("line"),
      width,
      height,
      quantity,
      specIds: draftLine.specIds
    }]);
    setDraftLine({
      width: "",
      height: "",
      quantity: "1",
      specIds: ["clear"]
    });
    setLineError("");
  }
  function removeLine(id) {
    setEstimateLines(current => current.filter(line => line.id !== id));
  }
  function toggleAddOn(addOnId) {
    setSelectedAddOns(current => current.includes(addOnId) ? current.filter(id => id !== addOnId) : [...current, addOnId]);
  }
  async function saveEstimate() {
    setSaveError("");
    setSaveMessage("");
    if (!estimateLines.length) {
      setSaveError("Add at least one glass line item before saving an estimate.");
      return;
    }
    try {
      const data = await apiRequest("/api/estimates", {
        method: "POST",
        body: JSON.stringify({
          name: estimateName || "Glass estimate",
          customerName,
          lines: estimateLines,
          selectedAddOns,
          laborSelection,
          taxEnabled,
          taxRate
        })
      });
      setEstimates(data.estimates || []);
      setEstimateName("");
      setCustomerName("");
      setSaveMessage("Estimate saved securely.");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Estimate could not be saved.");
    }
  }
  async function deleteEstimate(id) {
    try {
      const data = await apiRequest(`/api/estimates/${id}`, {
        method: "DELETE"
      });
      setEstimates(data.estimates || []);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Estimate could not be deleted.");
    }
  }
  function updateAdminGlassSpec(id, field, value) {
    setAdminStatus("idle");
    setAdminSettings(current => ({
      ...current,
      glassSpecs: current.glassSpecs.map(spec => spec.id === id ? {
        ...spec,
        [field]: field === "pricePerSqFt" ? normalizeNumber(value) : value
      } : spec)
    }));
  }
  function updateAdminAddOn(id, field, value) {
    setAdminStatus("idle");
    setAdminSettings(current => ({
      ...current,
      addOns: current.addOns.map(addOn => addOn.id === id ? {
        ...addOn,
        [field]: field === "cost" ? normalizeNumber(value) : value
      } : addOn)
    }));
  }
  function addAdminAddOn() {
    setAdminStatus("idle");
    setAdminSettings(current => {
      const index = current.addOns.length + 1;
      const id = makeId("add-on");
      return {
        ...current,
        addOns: [...current.addOns, {
          id,
          name: `Add-on ${index}`,
          cost: 0,
          costType: "flat"
        }]
      };
    });
  }
  function removeAdminAddOn(id) {
    setAdminStatus("idle");
    setAdminSettings(current => ({
      ...current,
      addOns: current.addOns.filter(addOn => addOn.id !== id)
    }));
  }
  function updateLabor(method, field, value) {
    setAdminStatus("idle");
    setAdminSettings(current => ({
      ...current,
      labor: {
        ...current.labor,
        [method]: {
          ...current.labor[method],
          [field]: typeof value === "boolean" ? value : normalizeNumber(value)
        }
      }
    }));
  }
  function validateAdmin(settingsToValidate) {
    if (!positive(settingsToValidate.markupMultiplier)) {
      return "Markup multiplier must be greater than zero.";
    }
    if (!settingsToValidate.glassSpecs.length) {
      return "At least one glass specification is required.";
    }
    const missingSpecName = settingsToValidate.glassSpecs.some(spec => !spec.name.trim());
    if (missingSpecName) {
      return "Every glass specification needs a name.";
    }
    const missingAddOnName = settingsToValidate.addOns.some(addOn => !addOn.name.trim());
    if (missingAddOnName) {
      return "Every add-on needs a name.";
    }
    return "";
  }
  async function saveAdminSettings() {
    if (!isAdmin) return;
    const prepared = {
      ...adminSettings,
      markupMultiplier: normalizeNumber(adminSettings.markupMultiplier),
      defaultTaxRate: normalizeNumber(adminSettings.defaultTaxRate),
      glassSpecs: adminSettings.glassSpecs.map((spec, index) => ({
        ...spec,
        id: slugify(spec.id || spec.name, `glass-spec-${index + 1}`),
        name: spec.name.trim(),
        pricePerSqFt: normalizeNumber(spec.pricePerSqFt)
      })),
      addOns: adminSettings.addOns.map((addOn, index) => ({
        ...addOn,
        id: slugify(addOn.id || addOn.name, `add-on-${index + 1}`),
        name: addOn.name.trim(),
        cost: normalizeNumber(addOn.cost)
      }))
    };
    const validationError = validateAdmin(prepared);
    if (validationError) {
      setAdminStatus("error");
      setAdminMessage(validationError);
      return;
    }
    try {
      setAdminStatus("saving");
      setAdminMessage("");
      const saved = await apiRequest("/api/settings", {
        method: "PUT",
        body: JSON.stringify(prepared)
      });
      setSettings(saved);
      setAdminSettings(cloneSettings(saved));
      setTaxRate(String(saved.defaultTaxRate ?? 0));
      setAdminStatus("saved");
      setAdminMessage("Pricing settings saved. The estimator is now using the latest values.");
    } catch (error) {
      setAdminStatus("error");
      setAdminMessage(error instanceof Error ? error.message : "Settings could not be saved.");
    }
  }
  async function createTeamMember() {
    setTeamStatus("");
    setTeamError("");
    try {
      const data = await apiRequest("/api/users", {
        method: "POST",
        body: JSON.stringify(teamDraft)
      });
      setUsers(data.users || []);
      setTeamDraft({
        name: "",
        email: "",
        password: "",
        role: "team_member"
      });
      setTeamStatus("Team member access created.");
    } catch (error) {
      setTeamError(error instanceof Error ? error.message : "Team member could not be created.");
    }
  }
  function patchTeamUser(id, patch) {
    setUsers(current => current.map(user => user.id === id ? {
      ...user,
      ...patch
    } : user));
  }
  async function updateTeamMember(user) {
    setTeamStatus("");
    setTeamError("");
    try {
      const payload = {
        name: user.name,
        email: user.email,
        role: user.role,
        active: user.active
      };
      if (user.passwordReset) payload.password = user.passwordReset;
      const data = await apiRequest(`/api/users/${user.id}`, {
        method: "PUT",
        body: JSON.stringify(payload)
      });
      setUsers(data.users || []);
      setTeamStatus("Team member access updated.");
    } catch (error) {
      setTeamError(error instanceof Error ? error.message : "Team member could not be updated.");
    }
  }
  async function deleteTeamMember(id) {
    setTeamStatus("");
    setTeamError("");
    try {
      const data = await apiRequest(`/api/users/${id}`, {
        method: "DELETE"
      });
      setUsers(data.users || []);
      setTeamStatus("Team member access removed.");
    } catch (error) {
      setTeamError(error instanceof Error ? error.message : "Team member could not be removed.");
    }
  }
  if (authLoading || authUser && loading) {
    return /*#__PURE__*/React.createElement("main", {
      className: "app-shell"
    }, /*#__PURE__*/React.createElement("section", {
      className: "loading-card"
    }, "Loading secure SJI workspace..."));
  }
  if (!authUser) {
    return /*#__PURE__*/React.createElement(LoginView, {
      email: loginEmail,
      error: loginError,
      loading: loginLoading,
      login: login,
      password: loginPassword,
      setEmail: setLoginEmail,
      setPassword: setLoginPassword
    });
  }
  return /*#__PURE__*/React.createElement("main", {
    className: "app-shell"
  }, /*#__PURE__*/React.createElement("header", {
    className: "hero"
  }, /*#__PURE__*/React.createElement("div", {
    className: "hero-overlay"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("p", {
    className: "eyebrow"
  }, "SJI Glass, Windows & Doors"), /*#__PURE__*/React.createElement("h1", null, "Glass Estimate Calculator"), /*#__PURE__*/React.createElement("p", {
    className: "hero-copy"
  }, "Authenticated estimating, pricing, labor, and team controls.")), /*#__PURE__*/React.createElement("div", {
    className: "top-actions"
  }, /*#__PURE__*/React.createElement("div", {
    className: "view-switch",
    "aria-label": "Application views"
  }, /*#__PURE__*/React.createElement("button", {
    className: activeView === "estimate" ? "active" : "",
    onClick: () => setActiveView("estimate"),
    type: "button"
  }, "Estimator"), /*#__PURE__*/React.createElement("button", {
    className: activeView === "saved" ? "active" : "",
    onClick: () => setActiveView("saved"),
    type: "button"
  }, "Saved Estimates"), isAdmin && /*#__PURE__*/React.createElement("button", {
    className: activeView === "admin" ? "active" : "",
    onClick: () => setActiveView("admin"),
    type: "button"
  }, "Pricing Settings"), isAdmin && /*#__PURE__*/React.createElement("button", {
    className: activeView === "team" ? "active" : "",
    onClick: () => setActiveView("team"),
    type: "button"
  }, "Team Access")), /*#__PURE__*/React.createElement("div", {
    className: "user-strip"
  }, /*#__PURE__*/React.createElement("span", null, authUser.name, /*#__PURE__*/React.createElement("small", null, isAdmin ? "Admin" : "Team Member")), /*#__PURE__*/React.createElement("button", {
    className: "ghost-button logout-button",
    onClick: logout,
    type: "button"
  }, "Sign out"))))), loadError && /*#__PURE__*/React.createElement("div", {
    className: "alert"
  }, loadError), activeView === "estimate" && /*#__PURE__*/React.createElement(EstimatorView, {
    addLine: addLine,
    customerName: customerName,
    draftLine: draftLine,
    estimateLines: estimateLines,
    estimateName: estimateName,
    lineError: lineError,
    removeLine: removeLine,
    saveError: saveError,
    saveEstimate: saveEstimate,
    saveMessage: saveMessage,
    selectedAddOns: selectedAddOns,
    setCustomerName: setCustomerName,
    setEstimateName: setEstimateName,
    settings: settings,
    taxEnabled: taxEnabled,
    taxRate: taxRate,
    toggleAddOn: toggleAddOn,
    toggleDraftSpec: toggleDraftSpec,
    totals: totals,
    updateDraft: updateDraft,
    laborSelection: laborSelection,
    setLaborSelection: setLaborSelection,
    setTaxEnabled: setTaxEnabled,
    setTaxRate: setTaxRate
  }), activeView === "saved" && /*#__PURE__*/React.createElement(SavedEstimatesView, {
    deleteEstimate: deleteEstimate,
    estimates: estimates,
    isAdmin: isAdmin,
    refreshEstimates: refreshEstimates
  }), activeView === "admin" && isAdmin && /*#__PURE__*/React.createElement(AdminView, {
    addAdminAddOn: addAdminAddOn,
    adminMessage: adminMessage,
    adminSettings: adminSettings,
    adminStatus: adminStatus,
    removeAdminAddOn: removeAdminAddOn,
    saveAdminSettings: saveAdminSettings,
    setAdminSettings: setAdminSettings,
    updateAdminAddOn: updateAdminAddOn,
    updateAdminGlassSpec: updateAdminGlassSpec,
    updateLabor: updateLabor
  }), activeView === "team" && isAdmin && /*#__PURE__*/React.createElement(TeamAccessView, {
    createTeamMember: createTeamMember,
    deleteTeamMember: deleteTeamMember,
    patchTeamUser: patchTeamUser,
    teamDraft: teamDraft,
    teamError: teamError,
    teamStatus: teamStatus,
    setTeamDraft: setTeamDraft,
    updateTeamMember: updateTeamMember,
    users: users
  }));
}
function LoginView({
  email,
  error,
  loading,
  login,
  password,
  setEmail,
  setPassword
}) {
  return /*#__PURE__*/React.createElement("main", {
    className: "login-shell"
  }, /*#__PURE__*/React.createElement("section", {
    className: "login-hero"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("p", {
    className: "eyebrow"
  }, "SJI Glass, Windows & Doors"), /*#__PURE__*/React.createElement("h1", null, "Secure Estimator"), /*#__PURE__*/React.createElement("p", null, "Sign in with an approved team account to access estimating tools and protected pricing."))), /*#__PURE__*/React.createElement("section", {
    className: "login-card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "section-heading compact"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("p", {
    className: "eyebrow"
  }, "Team Login"), /*#__PURE__*/React.createElement("h2", null, "Email and password"))), /*#__PURE__*/React.createElement("form", {
    onSubmit: login
  }, /*#__PURE__*/React.createElement("label", null, "Email", /*#__PURE__*/React.createElement("input", {
    autoComplete: "email",
    onChange: event => setEmail(event.target.value),
    required: true,
    type: "email",
    value: email
  })), /*#__PURE__*/React.createElement("label", null, "Password", /*#__PURE__*/React.createElement("input", {
    autoComplete: "current-password",
    onChange: event => setPassword(event.target.value),
    required: true,
    type: "password",
    value: password
  })), error && /*#__PURE__*/React.createElement("p", {
    className: "field-error"
  }, error), /*#__PURE__*/React.createElement("button", {
    className: "primary-button full-button",
    disabled: loading,
    type: "submit"
  }, loading ? "Signing in..." : "Sign in"))));
}
function EstimatorView(props) {
  const {
    addLine,
    customerName,
    draftLine,
    estimateLines,
    estimateName,
    lineError,
    removeLine,
    saveError,
    saveEstimate,
    saveMessage,
    selectedAddOns,
    setCustomerName,
    setEstimateName,
    settings,
    taxEnabled,
    taxRate,
    toggleAddOn,
    toggleDraftSpec,
    totals,
    updateDraft,
    laborSelection,
    setLaborSelection,
    setTaxEnabled,
    setTaxRate
  } = props;
  return /*#__PURE__*/React.createElement("div", {
    className: "page-grid"
  }, /*#__PURE__*/React.createElement("section", {
    className: "panel estimator-panel"
  }, /*#__PURE__*/React.createElement("div", {
    className: "section-heading"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("p", {
    className: "eyebrow"
  }, "Estimator"), /*#__PURE__*/React.createElement("h2", null, "Glass line item")), /*#__PURE__*/React.createElement("span", {
    className: "rate-pill"
  }, "Markup ", measurement(settings.markupMultiplier), "x")), /*#__PURE__*/React.createElement("div", {
    className: "input-grid"
  }, /*#__PURE__*/React.createElement("label", null, "Width in inches", /*#__PURE__*/React.createElement("input", {
    inputMode: "decimal",
    onChange: event => updateDraft("width", event.target.value),
    placeholder: "36 1/2",
    type: "text",
    value: draftLine.width
  })), /*#__PURE__*/React.createElement("label", null, "Height in inches", /*#__PURE__*/React.createElement("input", {
    inputMode: "decimal",
    onChange: event => updateDraft("height", event.target.value),
    placeholder: "48 3/4",
    type: "text",
    value: draftLine.height
  })), /*#__PURE__*/React.createElement("label", null, "Quantity", /*#__PURE__*/React.createElement("input", {
    min: "1",
    onChange: event => updateDraft("quantity", event.target.value),
    placeholder: "1",
    step: "1",
    type: "number",
    value: draftLine.quantity
  }))), /*#__PURE__*/React.createElement("div", {
    className: "checkbox-section"
  }, /*#__PURE__*/React.createElement("div", {
    className: "section-label"
  }, "Glass specifications"), /*#__PURE__*/React.createElement("div", {
    className: "checkbox-grid"
  }, settings.glassSpecs.map(spec => /*#__PURE__*/React.createElement("label", {
    className: "check-option",
    key: spec.id
  }, /*#__PURE__*/React.createElement("input", {
    checked: draftLine.specIds.includes(spec.id),
    onChange: () => toggleDraftSpec(spec.id),
    type: "checkbox"
  }), /*#__PURE__*/React.createElement("span", null, spec.name), /*#__PURE__*/React.createElement("strong", null, money(spec.pricePerSqFt), "/sq ft"))))), lineError && /*#__PURE__*/React.createElement("p", {
    className: "field-error"
  }, lineError), /*#__PURE__*/React.createElement("button", {
    className: "primary-button",
    onClick: addLine,
    type: "button"
  }, "Add line item"), /*#__PURE__*/React.createElement(EstimateLines, {
    estimateLines: estimateLines,
    removeLine: removeLine,
    settings: settings,
    totals: totals
  })), /*#__PURE__*/React.createElement("aside", {
    className: "summary-column"
  }, /*#__PURE__*/React.createElement("section", {
    className: "panel"
  }, /*#__PURE__*/React.createElement("div", {
    className: "section-heading compact"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("p", {
    className: "eyebrow"
  }, "Secure record"), /*#__PURE__*/React.createElement("h2", null, "Save Estimate"))), /*#__PURE__*/React.createElement("div", {
    className: "save-estimate-form"
  }, /*#__PURE__*/React.createElement("label", null, "Estimate name", /*#__PURE__*/React.createElement("input", {
    onChange: event => setEstimateName(event.target.value),
    placeholder: "Kitchen window replacement",
    type: "text",
    value: estimateName
  })), /*#__PURE__*/React.createElement("label", null, "Customer name", /*#__PURE__*/React.createElement("input", {
    onChange: event => setCustomerName(event.target.value),
    placeholder: "Customer or job name",
    type: "text",
    value: customerName
  })), saveError && /*#__PURE__*/React.createElement("p", {
    className: "field-error"
  }, saveError), saveMessage && /*#__PURE__*/React.createElement("p", {
    className: "success-copy"
  }, saveMessage), /*#__PURE__*/React.createElement("button", {
    className: "secondary-button",
    onClick: saveEstimate,
    type: "button"
  }, "Save estimate"))), /*#__PURE__*/React.createElement(AddOnsSection, {
    selectedAddOns: selectedAddOns,
    settings: settings,
    toggleAddOn: toggleAddOn,
    totals: totals
  }), /*#__PURE__*/React.createElement(LaborSection, {
    laborSelection: laborSelection,
    setLaborSelection: setLaborSelection,
    settings: settings,
    totals: totals
  }), /*#__PURE__*/React.createElement(EstimateSummary, {
    settings: settings,
    taxEnabled: taxEnabled,
    taxRate: taxRate,
    totals: totals,
    setTaxEnabled: setTaxEnabled,
    setTaxRate: setTaxRate
  })));
}
function EstimateLines({
  estimateLines,
  removeLine,
  settings,
  totals
}) {
  return /*#__PURE__*/React.createElement("section", {
    className: "line-list"
  }, /*#__PURE__*/React.createElement("div", {
    className: "section-heading compact"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("p", {
    className: "eyebrow"
  }, "Estimate"), /*#__PURE__*/React.createElement("h2", null, "Glass items")), /*#__PURE__*/React.createElement("span", {
    className: "muted"
  }, estimateLines.length, " line(s)")), !estimateLines.length ? /*#__PURE__*/React.createElement("div", {
    className: "empty-state"
  }, "Add the first glass line item to begin the estimate.") : /*#__PURE__*/React.createElement("div", {
    className: "table-wrap"
  }, /*#__PURE__*/React.createElement("table", null, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "Size"), /*#__PURE__*/React.createElement("th", null, "Qty"), /*#__PURE__*/React.createElement("th", null, "Sq ft"), /*#__PURE__*/React.createElement("th", null, "Specs"), /*#__PURE__*/React.createElement("th", null, "Price / sq ft"), /*#__PURE__*/React.createElement("th", null, "Line total"), /*#__PURE__*/React.createElement("th", null))), /*#__PURE__*/React.createElement("tbody", null, totals.lineCalculations.map(item => /*#__PURE__*/React.createElement("tr", {
    key: item.line.id
  }, /*#__PURE__*/React.createElement("td", {
    "data-label": "Size"
  }, measurement(item.line.width), " x ", measurement(item.line.height), " in"), /*#__PURE__*/React.createElement("td", {
    "data-label": "Qty"
  }, measurement(item.line.quantity)), /*#__PURE__*/React.createElement("td", {
    "data-label": "Sq ft"
  }, /*#__PURE__*/React.createElement("strong", null, measurement(item.unitSqFt)), " each", /*#__PURE__*/React.createElement("span", null, measurement(item.totalSqFt), " total")), /*#__PURE__*/React.createElement("td", {
    "data-label": "Specs"
  }, specNames(item.line, settings)), /*#__PURE__*/React.createElement("td", {
    "data-label": "Price / sq ft"
  }, money(item.pricePerSqFt)), /*#__PURE__*/React.createElement("td", {
    "data-label": "Line total"
  }, money(item.subtotal)), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("button", {
    className: "ghost-button small",
    onClick: () => removeLine(item.line.id),
    type: "button"
  }, "Remove"))))))));
}
function AddOnsSection({
  selectedAddOns,
  settings,
  toggleAddOn,
  totals
}) {
  return /*#__PURE__*/React.createElement("section", {
    className: "panel"
  }, /*#__PURE__*/React.createElement("div", {
    className: "section-heading compact"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("p", {
    className: "eyebrow"
  }, "Extras"), /*#__PURE__*/React.createElement("h2", null, "Add-ons"))), /*#__PURE__*/React.createElement("div", {
    className: "checkbox-list"
  }, settings.addOns.length ? settings.addOns.map(addOn => {
    const calculated = calculateAddOn(addOn, totals.totalSqFt, totals.totalQuantity);
    return /*#__PURE__*/React.createElement("label", {
      className: "check-option stacked",
      key: addOn.id
    }, /*#__PURE__*/React.createElement("input", {
      checked: selectedAddOns.includes(addOn.id),
      onChange: () => toggleAddOn(addOn.id),
      type: "checkbox"
    }), /*#__PURE__*/React.createElement("span", null, addOn.name, /*#__PURE__*/React.createElement("small", null, costTypeLabels[addOn.costType], " - ", calculated.basis)), /*#__PURE__*/React.createElement("strong", null, money(calculated.total)));
  }) : /*#__PURE__*/React.createElement("div", {
    className: "empty-state tight"
  }, "No add-ons are configured.")));
}
function LaborSection({
  laborSelection,
  setLaborSelection,
  settings,
  totals
}) {
  const hoursDisabled = !settings.labor.hourly.enabled;
  const perSqFtDisabled = !settings.labor.perSquareFoot.enabled;
  const flatDisabled = !settings.labor.flatFee.enabled;
  function patchLabor(patch) {
    setLaborSelection(current => ({
      ...current,
      ...patch
    }));
  }
  return /*#__PURE__*/React.createElement("section", {
    className: "panel"
  }, /*#__PURE__*/React.createElement("div", {
    className: "section-heading compact"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("p", {
    className: "eyebrow"
  }, "Install"), /*#__PURE__*/React.createElement("h2", null, "Labor Calculator"))), /*#__PURE__*/React.createElement("div", {
    className: "checkbox-list"
  }, /*#__PURE__*/React.createElement("label", {
    className: `check-option stacked ${hoursDisabled ? "disabled" : ""}`
  }, /*#__PURE__*/React.createElement("input", {
    checked: laborSelection.useHours,
    disabled: hoursDisabled,
    onChange: event => patchLabor({
      useHours: event.target.checked
    }),
    type: "checkbox"
  }), /*#__PURE__*/React.createElement("span", null, "Labor by hours", /*#__PURE__*/React.createElement("small", null, money(settings.labor.hourly.rate), " per hour"))), laborSelection.useHours && !hoursDisabled && /*#__PURE__*/React.createElement("label", {
    className: "inline-input"
  }, "Labor hours", /*#__PURE__*/React.createElement("input", {
    min: "0",
    onChange: event => patchLabor({
      hours: event.target.value
    }),
    placeholder: "0",
    step: "0.25",
    type: "number",
    value: laborSelection.hours
  })), /*#__PURE__*/React.createElement("label", {
    className: `check-option stacked ${perSqFtDisabled ? "disabled" : ""}`
  }, /*#__PURE__*/React.createElement("input", {
    checked: laborSelection.useSquareFoot,
    disabled: perSqFtDisabled,
    onChange: event => patchLabor({
      useSquareFoot: event.target.checked
    }),
    type: "checkbox"
  }), /*#__PURE__*/React.createElement("span", null, "Labor by square footage", /*#__PURE__*/React.createElement("small", null, money(settings.labor.perSquareFoot.rate), " x ", measurement(totals.totalSqFt), " sq ft")), /*#__PURE__*/React.createElement("strong", null, money(totals.totalSqFt * settings.labor.perSquareFoot.rate))), /*#__PURE__*/React.createElement("label", {
    className: `check-option stacked ${flatDisabled ? "disabled" : ""}`
  }, /*#__PURE__*/React.createElement("input", {
    checked: laborSelection.useFlatFee,
    disabled: flatDisabled,
    onChange: event => patchLabor({
      useFlatFee: event.target.checked
    }),
    type: "checkbox"
  }), /*#__PURE__*/React.createElement("span", null, "Labor flat fee", /*#__PURE__*/React.createElement("small", null, "Configured flat labor amount")), /*#__PURE__*/React.createElement("strong", null, money(settings.labor.flatFee.fee)))));
}
function EstimateSummary({
  settings,
  taxEnabled,
  taxRate,
  totals,
  setTaxEnabled,
  setTaxRate
}) {
  return /*#__PURE__*/React.createElement("section", {
    className: "summary-card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "section-heading compact"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("p", {
    className: "eyebrow"
  }, "Customer estimate"), /*#__PURE__*/React.createElement("h2", null, "Total"))), /*#__PURE__*/React.createElement("div", {
    className: "summary-lines"
  }, /*#__PURE__*/React.createElement(SummaryRow, {
    label: "Total square footage",
    value: `${measurement(totals.totalSqFt)} sq ft`
  }), /*#__PURE__*/React.createElement(SummaryRow, {
    label: "Total quantity",
    value: measurement(totals.totalQuantity)
  }), /*#__PURE__*/React.createElement(SummaryRow, {
    label: "Glass subtotal",
    value: money(totals.glassSubtotal)
  }), /*#__PURE__*/React.createElement(SummaryRow, {
    label: `Glass with markup (${measurement(settings.markupMultiplier)}x)`,
    value: money(totals.glassTotalWithMarkup)
  }), /*#__PURE__*/React.createElement(SummaryRow, {
    label: "Add-ons total",
    value: money(totals.addOnsTotal)
  }), totals.addOnTotals.map(item => /*#__PURE__*/React.createElement(SummaryRow, {
    key: item.addOn.id,
    label: item.addOn.name,
    value: money(item.total),
    small: true
  })), /*#__PURE__*/React.createElement(SummaryRow, {
    label: "Labor total",
    value: money(totals.laborTotal)
  }), totals.laborRows.map(row => /*#__PURE__*/React.createElement(SummaryRow, {
    key: row.label,
    label: row.label,
    value: money(row.total),
    small: true
  })), /*#__PURE__*/React.createElement(SummaryRow, {
    label: "Estimate subtotal",
    value: money(totals.preTaxTotal),
    strong: true
  })), /*#__PURE__*/React.createElement("div", {
    className: "tax-controls"
  }, /*#__PURE__*/React.createElement("label", {
    className: "toggle-row"
  }, /*#__PURE__*/React.createElement("input", {
    checked: taxEnabled,
    onChange: event => setTaxEnabled(event.target.checked),
    type: "checkbox"
  }), "Apply tax"), /*#__PURE__*/React.createElement("label", null, "Tax rate (%)", /*#__PURE__*/React.createElement("input", {
    min: "0",
    onChange: event => setTaxRate(event.target.value),
    step: "0.01",
    type: "number",
    value: taxRate
  }))), /*#__PURE__*/React.createElement("div", {
    className: "grand-total"
  }, /*#__PURE__*/React.createElement("span", null, "Grand total"), /*#__PURE__*/React.createElement("strong", null, money(totals.grandTotal))), taxEnabled && /*#__PURE__*/React.createElement("p", {
    className: "muted tight-copy"
  }, "Includes ", money(totals.taxAmount), " tax."));
}
function SummaryRow({
  label,
  value,
  small = false,
  strong = false
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: `summary-row ${small ? "small" : ""} ${strong ? "strong" : ""}`
  }, /*#__PURE__*/React.createElement("span", null, label), /*#__PURE__*/React.createElement("strong", null, value));
}
function SavedEstimatesView({
  deleteEstimate,
  estimates,
  isAdmin,
  refreshEstimates
}) {
  return /*#__PURE__*/React.createElement("section", {
    className: "panel max-panel"
  }, /*#__PURE__*/React.createElement("div", {
    className: "section-heading"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("p", {
    className: "eyebrow"
  }, "Estimates"), /*#__PURE__*/React.createElement("h2", null, "Saved Estimates")), /*#__PURE__*/React.createElement("button", {
    className: "secondary-button compact-button",
    onClick: refreshEstimates,
    type: "button"
  }, "Refresh")), !estimates.length ? /*#__PURE__*/React.createElement("div", {
    className: "empty-state"
  }, "No saved estimates yet.") : /*#__PURE__*/React.createElement("div", {
    className: "estimate-card-grid"
  }, estimates.map(estimate => /*#__PURE__*/React.createElement("article", {
    className: "estimate-card",
    key: estimate.id
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("p", {
    className: "eyebrow"
  }, estimate.customerName || "Customer estimate"), /*#__PURE__*/React.createElement("h3", null, estimate.name), /*#__PURE__*/React.createElement("p", {
    className: "muted"
  }, formatDate(estimate.createdAt), " by ", estimate.createdByName)), /*#__PURE__*/React.createElement("div", {
    className: "estimate-metrics"
  }, /*#__PURE__*/React.createElement(SummaryRow, {
    label: "Glass with markup",
    value: money(estimate.totals.glassTotalWithMarkup)
  }), /*#__PURE__*/React.createElement(SummaryRow, {
    label: "Add-ons",
    value: money(estimate.totals.addOnsTotal)
  }), /*#__PURE__*/React.createElement(SummaryRow, {
    label: "Labor",
    value: money(estimate.totals.laborTotal)
  }), /*#__PURE__*/React.createElement(SummaryRow, {
    label: "Grand total",
    value: money(estimate.totals.grandTotal),
    strong: true
  })), /*#__PURE__*/React.createElement("p", {
    className: "muted tight-copy"
  }, measurement(estimate.totals.totalSqFt), " sq ft across ", measurement(estimate.totals.totalQuantity), " item(s)"), isAdmin && /*#__PURE__*/React.createElement("button", {
    className: "ghost-button",
    onClick: () => deleteEstimate(estimate.id),
    type: "button"
  }, "Delete estimate")))));
}
function AdminView(props) {
  const {
    addAdminAddOn,
    adminMessage,
    adminSettings,
    adminStatus,
    removeAdminAddOn,
    saveAdminSettings,
    setAdminSettings,
    updateAdminAddOn,
    updateAdminGlassSpec,
    updateLabor
  } = props;
  return /*#__PURE__*/React.createElement("div", {
    className: "admin-layout"
  }, /*#__PURE__*/React.createElement("section", {
    className: "panel"
  }, /*#__PURE__*/React.createElement("div", {
    className: "section-heading"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("p", {
    className: "eyebrow"
  }, "Pricing Settings"), /*#__PURE__*/React.createElement("h2", null, "Glass Specs")), /*#__PURE__*/React.createElement("button", {
    className: "primary-button compact-button",
    onClick: saveAdminSettings,
    type: "button"
  }, adminStatus === "saving" ? "Saving..." : "Save settings")), adminMessage && /*#__PURE__*/React.createElement("div", {
    className: `status-message ${adminStatus === "error" ? "error" : "success"}`
  }, adminMessage), /*#__PURE__*/React.createElement("div", {
    className: "settings-table"
  }, /*#__PURE__*/React.createElement("div", {
    className: "settings-row header"
  }, /*#__PURE__*/React.createElement("span", null, "Specification"), /*#__PURE__*/React.createElement("span", null, "Price per square foot")), adminSettings.glassSpecs.map(spec => /*#__PURE__*/React.createElement("div", {
    className: "settings-row",
    key: spec.id
  }, /*#__PURE__*/React.createElement("label", null, "Name", /*#__PURE__*/React.createElement("input", {
    onChange: event => updateAdminGlassSpec(spec.id, "name", event.target.value),
    type: "text",
    value: spec.name
  })), /*#__PURE__*/React.createElement("label", null, "Price / sq ft", /*#__PURE__*/React.createElement("input", {
    min: "0",
    onChange: event => updateAdminGlassSpec(spec.id, "pricePerSqFt", event.target.value),
    step: "0.01",
    type: "number",
    value: spec.pricePerSqFt
  })))))), /*#__PURE__*/React.createElement("section", {
    className: "panel"
  }, /*#__PURE__*/React.createElement("div", {
    className: "section-heading compact"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("p", {
    className: "eyebrow"
  }, "Markup"), /*#__PURE__*/React.createElement("h2", null, "Estimate Settings"))), /*#__PURE__*/React.createElement("div", {
    className: "input-grid two"
  }, /*#__PURE__*/React.createElement("label", null, "Markup multiplier", /*#__PURE__*/React.createElement("input", {
    min: "0.01",
    onChange: event => setAdminSettings(current => ({
      ...current,
      markupMultiplier: normalizeNumber(event.target.value)
    })),
    step: "0.01",
    type: "number",
    value: adminSettings.markupMultiplier
  })), /*#__PURE__*/React.createElement("label", null, "Default tax rate (%)", /*#__PURE__*/React.createElement("input", {
    min: "0",
    onChange: event => setAdminSettings(current => ({
      ...current,
      defaultTaxRate: normalizeNumber(event.target.value)
    })),
    step: "0.01",
    type: "number",
    value: adminSettings.defaultTaxRate
  })))), /*#__PURE__*/React.createElement("section", {
    className: "panel"
  }, /*#__PURE__*/React.createElement("div", {
    className: "section-heading"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("p", {
    className: "eyebrow"
  }, "Extras"), /*#__PURE__*/React.createElement("h2", null, "Add-ons")), /*#__PURE__*/React.createElement("button", {
    className: "secondary-button compact-button",
    onClick: addAdminAddOn,
    type: "button"
  }, "Add add-on")), /*#__PURE__*/React.createElement("div", {
    className: "settings-table"
  }, /*#__PURE__*/React.createElement("div", {
    className: "settings-row header add-on"
  }, /*#__PURE__*/React.createElement("span", null, "Name"), /*#__PURE__*/React.createElement("span", null, "Cost"), /*#__PURE__*/React.createElement("span", null, "Cost type"), /*#__PURE__*/React.createElement("span", null)), adminSettings.addOns.map(addOn => /*#__PURE__*/React.createElement("div", {
    className: "settings-row add-on",
    key: addOn.id
  }, /*#__PURE__*/React.createElement("label", null, "Name", /*#__PURE__*/React.createElement("input", {
    onChange: event => updateAdminAddOn(addOn.id, "name", event.target.value),
    type: "text",
    value: addOn.name
  })), /*#__PURE__*/React.createElement("label", null, "Cost", /*#__PURE__*/React.createElement("input", {
    min: "0",
    onChange: event => updateAdminAddOn(addOn.id, "cost", event.target.value),
    step: "0.01",
    type: "number",
    value: addOn.cost
  })), /*#__PURE__*/React.createElement("label", null, "Cost type", /*#__PURE__*/React.createElement("select", {
    onChange: event => updateAdminAddOn(addOn.id, "costType", event.target.value),
    value: addOn.costType
  }, /*#__PURE__*/React.createElement("option", {
    value: "flat"
  }, "Flat fee"), /*#__PURE__*/React.createElement("option", {
    value: "per_sq_ft"
  }, "Per square foot"), /*#__PURE__*/React.createElement("option", {
    value: "per_item"
  }, "Per item/quantity"))), /*#__PURE__*/React.createElement("button", {
    className: "ghost-button",
    onClick: () => removeAdminAddOn(addOn.id),
    type: "button"
  }, "Remove"))))), /*#__PURE__*/React.createElement("section", {
    className: "panel"
  }, /*#__PURE__*/React.createElement("div", {
    className: "section-heading compact"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("p", {
    className: "eyebrow"
  }, "Labor"), /*#__PURE__*/React.createElement("h2", null, "Labor Pricing"))), /*#__PURE__*/React.createElement("div", {
    className: "labor-settings"
  }, /*#__PURE__*/React.createElement("div", {
    className: "labor-setting-row"
  }, /*#__PURE__*/React.createElement("label", {
    className: "toggle-row"
  }, /*#__PURE__*/React.createElement("input", {
    checked: adminSettings.labor.hourly.enabled,
    onChange: event => updateLabor("hourly", "enabled", event.target.checked),
    type: "checkbox"
  }), "Enable hourly labor"), /*#__PURE__*/React.createElement("label", null, "Hourly rate", /*#__PURE__*/React.createElement("input", {
    min: "0",
    onChange: event => updateLabor("hourly", "rate", event.target.value),
    step: "0.01",
    type: "number",
    value: adminSettings.labor.hourly.rate
  }))), /*#__PURE__*/React.createElement("div", {
    className: "labor-setting-row"
  }, /*#__PURE__*/React.createElement("label", {
    className: "toggle-row"
  }, /*#__PURE__*/React.createElement("input", {
    checked: adminSettings.labor.perSquareFoot.enabled,
    onChange: event => updateLabor("perSquareFoot", "enabled", event.target.checked),
    type: "checkbox"
  }), "Enable labor per square foot"), /*#__PURE__*/React.createElement("label", null, "Labor rate / sq ft", /*#__PURE__*/React.createElement("input", {
    min: "0",
    onChange: event => updateLabor("perSquareFoot", "rate", event.target.value),
    step: "0.01",
    type: "number",
    value: adminSettings.labor.perSquareFoot.rate
  }))), /*#__PURE__*/React.createElement("div", {
    className: "labor-setting-row"
  }, /*#__PURE__*/React.createElement("label", {
    className: "toggle-row"
  }, /*#__PURE__*/React.createElement("input", {
    checked: adminSettings.labor.flatFee.enabled,
    onChange: event => updateLabor("flatFee", "enabled", event.target.checked),
    type: "checkbox"
  }), "Enable flat labor fee"), /*#__PURE__*/React.createElement("label", null, "Flat labor fee", /*#__PURE__*/React.createElement("input", {
    min: "0",
    onChange: event => updateLabor("flatFee", "fee", event.target.value),
    step: "0.01",
    type: "number",
    value: adminSettings.labor.flatFee.fee
  }))))));
}
function TeamAccessView(props) {
  const {
    createTeamMember,
    deleteTeamMember,
    patchTeamUser,
    teamDraft,
    teamError,
    teamStatus,
    setTeamDraft,
    updateTeamMember,
    users
  } = props;
  return /*#__PURE__*/React.createElement("div", {
    className: "admin-layout"
  }, /*#__PURE__*/React.createElement("section", {
    className: "panel"
  }, /*#__PURE__*/React.createElement("div", {
    className: "section-heading compact"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("p", {
    className: "eyebrow"
  }, "Access Control"), /*#__PURE__*/React.createElement("h2", null, "Create Team Member"))), /*#__PURE__*/React.createElement("div", {
    className: "input-grid two"
  }, /*#__PURE__*/React.createElement("label", null, "Name", /*#__PURE__*/React.createElement("input", {
    onChange: event => setTeamDraft(current => ({
      ...current,
      name: event.target.value
    })),
    type: "text",
    value: teamDraft.name
  })), /*#__PURE__*/React.createElement("label", null, "Email", /*#__PURE__*/React.createElement("input", {
    onChange: event => setTeamDraft(current => ({
      ...current,
      email: event.target.value
    })),
    type: "email",
    value: teamDraft.email
  })), /*#__PURE__*/React.createElement("label", null, "Temporary password", /*#__PURE__*/React.createElement("input", {
    onChange: event => setTeamDraft(current => ({
      ...current,
      password: event.target.value
    })),
    type: "password",
    value: teamDraft.password
  })), /*#__PURE__*/React.createElement("label", null, "Role", /*#__PURE__*/React.createElement("select", {
    onChange: event => setTeamDraft(current => ({
      ...current,
      role: event.target.value
    })),
    value: teamDraft.role
  }, /*#__PURE__*/React.createElement("option", {
    value: "team_member"
  }, "Team Member"), /*#__PURE__*/React.createElement("option", {
    value: "admin"
  }, "Admin")))), teamError && /*#__PURE__*/React.createElement("p", {
    className: "field-error"
  }, teamError), teamStatus && /*#__PURE__*/React.createElement("p", {
    className: "success-copy"
  }, teamStatus), /*#__PURE__*/React.createElement("button", {
    className: "primary-button",
    onClick: createTeamMember,
    type: "button"
  }, "Create access")), /*#__PURE__*/React.createElement("section", {
    className: "panel"
  }, /*#__PURE__*/React.createElement("div", {
    className: "section-heading compact"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("p", {
    className: "eyebrow"
  }, "Directory"), /*#__PURE__*/React.createElement("h2", null, "Team Members"))), /*#__PURE__*/React.createElement("div", {
    className: "settings-table"
  }, /*#__PURE__*/React.createElement("div", {
    className: "settings-row header team-row"
  }, /*#__PURE__*/React.createElement("span", null, "Name"), /*#__PURE__*/React.createElement("span", null, "Email"), /*#__PURE__*/React.createElement("span", null, "Role"), /*#__PURE__*/React.createElement("span", null, "Status"), /*#__PURE__*/React.createElement("span", null, "Password"), /*#__PURE__*/React.createElement("span", null)), users.map(user => /*#__PURE__*/React.createElement("div", {
    className: "settings-row team-row",
    key: user.id
  }, /*#__PURE__*/React.createElement("label", null, "Name", /*#__PURE__*/React.createElement("input", {
    onChange: event => patchTeamUser(user.id, {
      name: event.target.value
    }),
    type: "text",
    value: user.name
  })), /*#__PURE__*/React.createElement("label", null, "Email", /*#__PURE__*/React.createElement("input", {
    onChange: event => patchTeamUser(user.id, {
      email: event.target.value
    }),
    type: "email",
    value: user.email
  })), /*#__PURE__*/React.createElement("label", null, "Role", /*#__PURE__*/React.createElement("select", {
    onChange: event => patchTeamUser(user.id, {
      role: event.target.value
    }),
    value: user.role
  }, /*#__PURE__*/React.createElement("option", {
    value: "team_member"
  }, "Team Member"), /*#__PURE__*/React.createElement("option", {
    value: "admin"
  }, "Admin"))), /*#__PURE__*/React.createElement("label", {
    className: "toggle-row"
  }, /*#__PURE__*/React.createElement("input", {
    checked: user.active,
    onChange: event => patchTeamUser(user.id, {
      active: event.target.checked
    }),
    type: "checkbox"
  }), "Active"), /*#__PURE__*/React.createElement("label", null, "Reset password", /*#__PURE__*/React.createElement("input", {
    onChange: event => patchTeamUser(user.id, {
      passwordReset: event.target.value
    }),
    placeholder: "Leave blank",
    type: "password",
    value: user.passwordReset || ""
  })), /*#__PURE__*/React.createElement("div", {
    className: "row-actions"
  }, /*#__PURE__*/React.createElement("button", {
    className: "secondary-button",
    onClick: () => updateTeamMember(user),
    type: "button"
  }, "Save"), /*#__PURE__*/React.createElement("button", {
    className: "ghost-button",
    onClick: () => deleteTeamMember(user.id),
    type: "button"
  }, "Delete")))))));
}
ReactDOM.createRoot(document.getElementById("root")).render(/*#__PURE__*/React.createElement(App, null));
