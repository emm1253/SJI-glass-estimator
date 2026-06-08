declare const React: any;
declare const ReactDOM: any;

const { useEffect, useMemo, useState } = React;

type Role = "admin" | "team_member";
type ActiveView = "estimate" | "saved" | "admin" | "team";
type CostType = "flat" | "per_sq_ft" | "per_item";

type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  active: boolean;
};

type TeamUser = AuthUser & {
  createdAt?: string;
  updatedAt?: string;
  passwordReset?: string;
};

type GlassSpec = {
  id: string;
  name: string;
  pricePerSqFt: number;
};

type AddOn = {
  id: string;
  name: string;
  cost: number;
  costType: CostType;
};

type JobCostSettings = {
  laborHourlyRate: number;
  logisticsHourlyRate: number;
  disposalHourlyRate: number;
  scaffoldingHourlyRate: number;
};

type PricingSettings = {
  markupMultiplier: number;
  defaultTaxRate: number;
  glassSpecs: GlassSpec[];
  addOns: AddOn[];
  jobCosts: JobCostSettings;
};

type EstimateLine = {
  id: string;
  width: number;
  height: number;
  quantity: number;
  specIds: string[];
  laborHours?: number;
  scaffoldingHours?: number;
};

type DraftLine = {
  width: string;
  height: string;
  quantity: string;
  specIds: string[];
  laborHours: string;
  scaffoldingHours: string;
};

type EstimateJobCosts = {
  logisticsHours: string;
  disposalHours: string;
};

type AddOnTotal = {
  addOn: AddOn;
  total: number;
  basis: string;
  quantity: number;
};

type SavedEstimate = {
  id: string;
  name: string;
  customerName: string;
  createdByName: string;
  createdAt: string;
  totals: {
    totalSqFt: number;
    totalQuantity: number;
    glassSubtotal: number;
    glassTotalWithMarkup: number;
    addOnsTotal: number;
    laborTotal: number;
    logisticsTotal: number;
    disposalTotal: number;
    scaffoldingTotal?: number;
    preTaxTotal: number;
    taxAmount: number;
    grandTotal: number;
  };
  lines?: EstimateLine[];
  lineCalculations?: any[];
  selectedAddOns?: string[];
  jobCosts?: any;
  addOnTotals?: AddOnTotal[];
  pricingSnapshot?: PricingSettings;
};

type AdminStatus = "idle" | "saving" | "saved" | "error";

const fallbackSettings: PricingSettings = {
  markupMultiplier: 2.25,
  defaultTaxRate: 0,
  glassSpecs: [
    { id: "clear", name: "Clear", pricePerSqFt: 0 },
    { id: "lowe", name: "LowE", pricePerSqFt: 2 },
    { id: "tempered", name: "Tempered", pricePerSqFt: 5 },
    { id: "annealed", name: "Annealed", pricePerSqFt: 1.25 },
    { id: "colored-spacer", name: "Colored Spacer", pricePerSqFt: 0.75 },
    { id: "argon", name: "Argon", pricePerSqFt: 1.5 },
    { id: "pattern", name: "Pattern", pricePerSqFt: 3 },
    { id: "eighth-over-eighth", name: "1/8 over 1/8", pricePerSqFt: 2.5 },
    { id: "sixteenth-over-sixteenth", name: "1/16 over 1/16", pricePerSqFt: 1.75 }
  ],
  addOns: [],
  jobCosts: {
    laborHourlyRate: 95,
    logisticsHourlyRate: 85,
    disposalHourlyRate: 65,
    scaffoldingHourlyRate: 0
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

const costTypeLabels: Record<CostType, string> = {
  flat: "Flat fee",
  per_sq_ft: "Per square foot",
  per_item: "Per item/quantity"
};

function money(value: number): string {
  return currency.format(Number.isFinite(value) ? value : 0);
}

function measurement(value: number): string {
  return numberFormat.format(Number.isFinite(value) ? value : 0);
}

function positive(value: string | number): boolean {
  return Number(value) > 0;
}

function parseFractionalInches(value: string | number): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : Number.NaN;
  }

  const raw = value.trim();
  if (!raw || raw.startsWith("-")) return Number.NaN;

  const normalized = raw
    .replace(/"/g, "")
    .replace(/\s*\/\s*/g, "/")
    .replace(/(\d)-(?=\d)/g, "$1 ")
    .replace(/\s+/g, " ");

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

function makeId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.round(Math.random() * 100000)}`;
}

function cloneSettings(settings: PricingSettings): PricingSettings {
  return JSON.parse(JSON.stringify(settings));
}

function slugify(value: string, fallback: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || fallback;
}

function normalizeNumber(value: string | number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
}

function formatDate(value: string): string {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function specNames(line: EstimateLine, settings: PricingSettings): string {
  const names = settings.glassSpecs
    .filter((spec) => line.specIds.includes(spec.id))
    .map((spec) => spec.name);
  return names.length ? names.join(", ") : "No specs selected";
}

function specDetails(line: EstimateLine, settings: PricingSettings) {
  return settings.glassSpecs
    .filter((spec) => line.specIds.includes(spec.id))
    .map((spec) => ({
      id: spec.id,
      name: spec.name,
      pricePerSqFt: spec.pricePerSqFt
    }));
}

function squareFeet(width: number, height: number): number {
  return (width * height) / 144;
}

function specPricePerSqFt(line: EstimateLine, settings: PricingSettings): number {
  return settings.glassSpecs.reduce((total, spec) => {
    return line.specIds.includes(spec.id) ? total + spec.pricePerSqFt : total;
  }, 0);
}

function calculateLine(line: EstimateLine, settings: PricingSettings) {
  const unitSqFt = squareFeet(line.width, line.height);
  const totalSqFt = unitSqFt * line.quantity;
  const selectedSpecs = specDetails(line, settings);
  const rawGlassPricePerSqFt = specPricePerSqFt(line, settings);
  const markupMultiplier = settings.markupMultiplier;
  const glassPricePerSqFtAfterMarkup = rawGlassPricePerSqFt * markupMultiplier;
  const rawGlassTotal = totalSqFt * rawGlassPricePerSqFt;
  const glassTotalAfterMarkup = totalSqFt * glassPricePerSqFtAfterMarkup;
  const jobCostRates = settings.jobCosts || fallbackSettings.jobCosts;
  const laborRate = normalizeNumber(jobCostRates.laborHourlyRate ?? 0);
  const scaffoldingRate = normalizeNumber(jobCostRates.scaffoldingHourlyRate ?? 0);
  const laborHours = normalizeNumber(line.laborHours ?? 0);
  const scaffoldingHours = normalizeNumber(line.scaffoldingHours ?? 0);
  const jobCosts = {
    labor: {
      hours: laborHours,
      rate: laborRate,
      total: laborHours * laborRate
    },
    scaffolding: {
      hours: scaffoldingHours,
      rate: scaffoldingRate,
      total: scaffoldingHours * scaffoldingRate
    }
  };
  const lineJobCostsTotal =
    jobCosts.labor.total +
    jobCosts.scaffolding.total;
  const lineItemTotal = glassTotalAfterMarkup + lineJobCostsTotal;

  return {
    unitSqFt,
    totalSqFt,
    selectedSpecs,
    rawGlassPricePerSqFt,
    pricePerSqFt: rawGlassPricePerSqFt,
    markupMultiplier,
    glassPricePerSqFtAfterMarkup,
    rawGlassTotal,
    subtotal: rawGlassTotal,
    glassTotalAfterMarkup,
    addOnTotals: [],
    addOnsTotal: 0,
    jobCosts,
    lineJobCostsTotal,
    lineItemTotal
  };
}

function calculateAddOn(addOn: AddOn, totalSqFt: number, totalQuantity: number): AddOnTotal {
  if (addOn.costType === "per_sq_ft") {
    return {
      addOn,
      total: addOn.cost * totalSqFt,
      basis: `${money(addOn.cost)} x ${measurement(totalSqFt)} sq ft`,
      quantity: totalSqFt
    };
  }

  if (addOn.costType === "per_item") {
    return {
      addOn,
      total: addOn.cost * totalQuantity,
      basis: `${money(addOn.cost)} x ${measurement(totalQuantity)} items`,
      quantity: totalQuantity
    };
  }

  return {
    addOn,
    total: addOn.cost,
    basis: "Flat fee",
    quantity: 1
  };
}

async function responseJson(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Request failed.");
  }
  return data;
}

function App() {
  const [activeView, setActiveView] = useState<ActiveView>("estimate");
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [settings, setSettings] = useState<PricingSettings>(fallbackSettings);
  const [adminSettings, setAdminSettings] = useState<PricingSettings>(cloneSettings(fallbackSettings));
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [adminStatus, setAdminStatus] = useState<AdminStatus>("idle");
  const [adminMessage, setAdminMessage] = useState("");
  const [draftLine, setDraftLine] = useState<DraftLine>({
    width: "",
    height: "",
    quantity: "1",
    specIds: ["clear"],
    laborHours: "",
    scaffoldingHours: ""
  });
  const [lineError, setLineError] = useState("");
  const [estimateLines, setEstimateLines] = useState<EstimateLine[]>([]);
  const [selectedAddOns, setSelectedAddOns] = useState<string[]>([]);
  const [jobCosts, setJobCosts] = useState<EstimateJobCosts>({
    logisticsHours: "",
    disposalHours: ""
  });
  const [taxEnabled, setTaxEnabled] = useState(false);
  const [taxRate, setTaxRate] = useState("0");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [teamStatus, setTeamStatus] = useState("");
  const [teamError, setTeamError] = useState("");
  const [teamDraft, setTeamDraft] = useState({
    name: "",
    email: "",
    password: "",
    role: "team_member" as Role
  });
  const [estimates, setEstimates] = useState<SavedEstimate[]>([]);
  const [estimateName, setEstimateName] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const [saveError, setSaveError] = useState("");

  const isAdmin = authUser?.role === "admin";

  async function apiRequest(path: string, options: any = {}) {
    const response = await fetch(path, {
      ...options,
      credentials: "same-origin",
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
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

  async function loadAuthorizedData(user: AuthUser) {
    setLoading(true);
    setLoadError("");
    try {
      await Promise.all([
        refreshSettings(),
        refreshEstimates(),
        user.role === "admin" ? refreshUsers() : Promise.resolve()
      ]);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not load secure app data.");
    } finally {
      setLoading(false);
    }
  }

  async function checkSession() {
    try {
      const response = await fetch("/api/session", { credentials: "same-origin" });
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

  async function login(event: any) {
    event.preventDefault();
    setLoginLoading(true);
    setLoginError("");

    try {
      const data = await apiRequest("/api/login", {
        method: "POST",
        body: JSON.stringify({ email: loginEmail, password: loginPassword })
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
    await apiRequest("/api/logout", { method: "POST" }).catch(() => null);
    setAuthUser(null);
    setUsers([]);
    setEstimates([]);
    setEstimateLines([]);
    setSelectedAddOns([]);
    setActiveView("estimate");
  }

  const totals = useMemo(() => {
    const lineCalculations = estimateLines.map((line) => ({
      line,
      ...calculateLine(line, settings)
    }));
    const totalSqFt = lineCalculations.reduce((total, line) => total + line.totalSqFt, 0);
    const totalQuantity = estimateLines.reduce((total, line) => total + line.quantity, 0);
    const glassSubtotal = lineCalculations.reduce((total, line) => total + line.subtotal, 0);
    const glassTotalWithMarkup = lineCalculations.reduce((total, line) => total + line.glassTotalAfterMarkup, 0);
    const addOnTotals = settings.addOns
      .filter((addOn) => selectedAddOns.includes(addOn.id))
      .map((addOn) => calculateAddOn(addOn, totalSqFt, totalQuantity));
    const addOnsTotal = addOnTotals.reduce((total, item) => total + item.total, 0);
    const laborTotal = lineCalculations.reduce((total, line) => total + line.jobCosts.labor.total, 0);
    const scaffoldingTotal = lineCalculations.reduce((total, line) => total + line.jobCosts.scaffolding.total, 0);
    const logisticsHours = normalizeNumber(jobCosts.logisticsHours);
    const disposalHours = normalizeNumber(jobCosts.disposalHours);
    const logisticsTotal = logisticsHours * normalizeNumber(settings.jobCosts.logisticsHourlyRate ?? 0);
    const disposalTotal = disposalHours * normalizeNumber(settings.jobCosts.disposalHourlyRate ?? 0);
    const preTaxTotal = glassTotalWithMarkup + addOnsTotal + laborTotal + logisticsTotal + disposalTotal + scaffoldingTotal;
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
      laborTotal,
      logisticsTotal,
      disposalTotal,
      scaffoldingTotal,
      preTaxTotal,
      taxAmount,
      grandTotal
    };
  }, [estimateLines, jobCosts, selectedAddOns, settings, taxEnabled, taxRate]);

  function updateDraft(field: keyof DraftLine, value: string | string[]) {
    setDraftLine((current) => ({
      ...current,
      [field]: value
    }));
    setLineError("");
  }

  function toggleDraftSpec(specId: string) {
    setDraftLine((current) => {
      const specIds = current.specIds.includes(specId)
        ? current.specIds.filter((id) => id !== specId)
        : [...current.specIds, specId];
      return { ...current, specIds };
    });
  }

  function toggleAddOn(addOnId: string) {
    setSelectedAddOns((current) =>
      current.includes(addOnId) ? current.filter((id) => id !== addOnId) : [...current, addOnId]
    );
  }

  function addLine() {
    const width = parseFractionalInches(draftLine.width);
    const height = parseFractionalInches(draftLine.height);
    const quantity = Number(draftLine.quantity);

    if (!(width > 0) || !(height > 0) || !(quantity > 0)) {
      setLineError("Width, height, and quantity must be positive values.");
      return;
    }

    setEstimateLines((current) => [
      ...current,
      {
        id: makeId("line"),
        width,
        height,
        quantity,
        specIds: draftLine.specIds,
        laborHours: normalizeNumber(draftLine.laborHours),
        scaffoldingHours: normalizeNumber(draftLine.scaffoldingHours)
      }
    ]);

    setDraftLine({
      width: "",
      height: "",
      quantity: "1",
      specIds: ["clear"],
      laborHours: "",
      scaffoldingHours: ""
    });
    setLineError("");
  }

  function removeLine(id: string) {
    setEstimateLines((current) => current.filter((line) => line.id !== id));
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
          jobCosts,
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

  async function deleteEstimate(id: string) {
    try {
      const data = await apiRequest(`/api/estimates/${id}`, { method: "DELETE" });
      setEstimates(data.estimates || []);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Estimate could not be deleted.");
    }
  }

  function updateAdminGlassSpec(id: string, field: keyof GlassSpec, value: string) {
    setAdminStatus("idle");
    setAdminSettings((current) => ({
      ...current,
      glassSpecs: current.glassSpecs.map((spec) =>
        spec.id === id
          ? {
              ...spec,
              [field]: field === "pricePerSqFt" ? normalizeNumber(value) : value
            }
          : spec
      )
    }));
  }

  function updateAdminAddOn(id: string, field: keyof AddOn, value: string) {
    setAdminStatus("idle");
    setAdminSettings((current) => ({
      ...current,
      addOns: current.addOns.map((addOn) =>
        addOn.id === id
          ? {
              ...addOn,
              [field]: field === "cost" ? normalizeNumber(value) : value
            }
          : addOn
      )
    }));
  }

  function addAdminAddOn() {
    setAdminStatus("idle");
    setAdminSettings((current) => {
      const index = current.addOns.length + 1;
      const id = makeId("add-on");
      return {
        ...current,
        addOns: [
          ...current.addOns,
          {
            id,
            name: `Add-on ${index}`,
            cost: 0,
            costType: "flat"
          }
        ]
      };
    });
  }

  function removeAdminAddOn(id: string) {
    setAdminStatus("idle");
    setAdminSettings((current) => ({
      ...current,
      addOns: current.addOns.filter((addOn) => addOn.id !== id)
    }));
  }

  function updateJobCostRate(field: keyof JobCostSettings, value: string) {
    setAdminStatus("idle");
    setAdminSettings((current) => ({
      ...current,
      jobCosts: {
        ...current.jobCosts,
        [field]: normalizeNumber(value)
      }
    }));
  }

  function validateAdmin(settingsToValidate: PricingSettings): string {
    if (!positive(settingsToValidate.markupMultiplier)) {
      return "Markup multiplier must be greater than zero.";
    }

    if (!settingsToValidate.glassSpecs.length) {
      return "At least one glass specification is required.";
    }

    const missingSpecName = settingsToValidate.glassSpecs.some((spec) => !spec.name.trim());
    if (missingSpecName) {
      return "Every glass specification needs a name.";
    }

    const missingAddOnName = settingsToValidate.addOns.some((addOn) => !addOn.name.trim());
    if (missingAddOnName) {
      return "Every add-on needs a name.";
    }

    return "";
  }

  async function saveAdminSettings() {
    if (!isAdmin) return;

    const prepared: PricingSettings = {
      ...adminSettings,
      markupMultiplier: normalizeNumber(adminSettings.markupMultiplier),
      defaultTaxRate: normalizeNumber(adminSettings.defaultTaxRate),
      glassSpecs: adminSettings.glassSpecs.map((spec, index) => ({
        ...spec,
        id: slugify(spec.id || spec.name, `glass-spec-${index + 1}`),
        name: spec.name.trim(),
        pricePerSqFt: normalizeNumber(spec.pricePerSqFt)
      })),
      addOns: adminSettings.addOns
        .filter((addOn) => !["logistics", "disposal", "scaffolding"].includes(slugify(addOn.id || addOn.name, "")))
        .map((addOn, index) => ({
          ...addOn,
          id: slugify(addOn.id || addOn.name, `add-on-${index + 1}`),
          name: addOn.name.trim(),
          cost: normalizeNumber(addOn.cost)
        })),
      jobCosts: {
        laborHourlyRate: normalizeNumber(adminSettings.jobCosts.laborHourlyRate),
        logisticsHourlyRate: normalizeNumber(adminSettings.jobCosts.logisticsHourlyRate),
        disposalHourlyRate: normalizeNumber(adminSettings.jobCosts.disposalHourlyRate),
        scaffoldingHourlyRate: normalizeNumber(adminSettings.jobCosts.scaffoldingHourlyRate)
      }
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
      setTeamDraft({ name: "", email: "", password: "", role: "team_member" });
      setTeamStatus("Team member access created.");
    } catch (error) {
      setTeamError(error instanceof Error ? error.message : "Team member could not be created.");
    }
  }

  function patchTeamUser(id: string, patch: Partial<TeamUser>) {
    setUsers((current) => current.map((user) => user.id === id ? { ...user, ...patch } : user));
  }

  async function updateTeamMember(user: TeamUser) {
    setTeamStatus("");
    setTeamError("");

    try {
      const payload: any = {
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

  async function deleteTeamMember(id: string) {
    setTeamStatus("");
    setTeamError("");

    try {
      const data = await apiRequest(`/api/users/${id}`, { method: "DELETE" });
      setUsers(data.users || []);
      setTeamStatus("Team member access removed.");
    } catch (error) {
      setTeamError(error instanceof Error ? error.message : "Team member could not be removed.");
    }
  }

  if (authLoading || (authUser && loading)) {
    return (
      <main className="app-shell">
        <section className="loading-card">Loading secure SJI workspace...</section>
      </main>
    );
  }

  if (!authUser) {
    return (
      <LoginView
        email={loginEmail}
        error={loginError}
        loading={loginLoading}
        login={login}
        password={loginPassword}
        setEmail={setLoginEmail}
        setPassword={setLoginPassword}
      />
    );
  }

  return (
    <main className="app-shell">
      <header className="hero">
        <div className="hero-overlay">
          <div>
            <p className="eyebrow">SJI Glass, Windows & Doors</p>
            <h1>Glass Estimate Calculator</h1>
            <p className="hero-copy">Authenticated estimating, pricing, labor, and team controls.</p>
          </div>
          <div className="top-actions">
            <div className="view-switch" aria-label="Application views">
              <button
                className={activeView === "estimate" ? "active" : ""}
                onClick={() => setActiveView("estimate")}
                type="button"
              >
                Estimator
              </button>
              <button
                className={activeView === "saved" ? "active" : ""}
                onClick={() => setActiveView("saved")}
                type="button"
              >
                Saved Estimates
              </button>
              {isAdmin && (
                <button
                  className={activeView === "admin" ? "active" : ""}
                  onClick={() => setActiveView("admin")}
                  type="button"
                >
                  Pricing Settings
                </button>
              )}
              {isAdmin && (
                <button
                  className={activeView === "team" ? "active" : ""}
                  onClick={() => setActiveView("team")}
                  type="button"
                >
                  Team Access
                </button>
              )}
            </div>
            <div className="user-strip">
              <span>
                {authUser.name}
                <small>{isAdmin ? "Admin" : "Team Member"}</small>
              </span>
              <button className="ghost-button logout-button" onClick={logout} type="button">
                Sign out
              </button>
            </div>
          </div>
        </div>
      </header>

      {loadError && <div className="alert">{loadError}</div>}

      {activeView === "estimate" && (
        <EstimatorView
          addLine={addLine}
          customerName={customerName}
          draftLine={draftLine}
          estimateLines={estimateLines}
          estimateName={estimateName}
          lineError={lineError}
          removeLine={removeLine}
          saveError={saveError}
          saveEstimate={saveEstimate}
          saveMessage={saveMessage}
          selectedAddOns={selectedAddOns}
          setCustomerName={setCustomerName}
          setEstimateName={setEstimateName}
          settings={settings}
          taxEnabled={taxEnabled}
          taxRate={taxRate}
          toggleAddOn={toggleAddOn}
          toggleDraftSpec={toggleDraftSpec}
          totals={totals}
          updateDraft={updateDraft}
          jobCosts={jobCosts}
          setJobCosts={setJobCosts}
          setTaxEnabled={setTaxEnabled}
          setTaxRate={setTaxRate}
        />
      )}

      {activeView === "saved" && (
        <SavedEstimatesView
          deleteEstimate={deleteEstimate}
          estimates={estimates}
          isAdmin={isAdmin}
          refreshEstimates={refreshEstimates}
          settings={settings}
        />
      )}

      {activeView === "admin" && isAdmin && (
        <AdminView
          addAdminAddOn={addAdminAddOn}
          adminMessage={adminMessage}
          adminSettings={adminSettings}
          adminStatus={adminStatus}
          removeAdminAddOn={removeAdminAddOn}
          saveAdminSettings={saveAdminSettings}
          setAdminSettings={setAdminSettings}
          updateAdminAddOn={updateAdminAddOn}
          updateAdminGlassSpec={updateAdminGlassSpec}
          updateJobCostRate={updateJobCostRate}
        />
      )}

      {activeView === "team" && isAdmin && (
        <TeamAccessView
          createTeamMember={createTeamMember}
          deleteTeamMember={deleteTeamMember}
          patchTeamUser={patchTeamUser}
          teamDraft={teamDraft}
          teamError={teamError}
          teamStatus={teamStatus}
          setTeamDraft={setTeamDraft}
          updateTeamMember={updateTeamMember}
          users={users}
        />
      )}
    </main>
  );
}

function LoginView({ email, error, loading, login, password, setEmail, setPassword }: any) {
  return (
    <main className="login-shell">
      <section className="login-hero">
        <div>
          <p className="eyebrow">SJI Glass, Windows & Doors</p>
          <h1>Secure Estimator</h1>
          <p>Sign in with an approved team account to access estimating tools and protected pricing.</p>
        </div>
      </section>

      <section className="login-card">
        <div className="section-heading compact">
          <div>
            <p className="eyebrow">Team Login</p>
            <h2>Email and password</h2>
          </div>
        </div>
        <form onSubmit={login}>
          <label>
            Email
            <input
              autoComplete="email"
              onChange={(event: any) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </label>
          <label>
            Password
            <input
              autoComplete="current-password"
              onChange={(event: any) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </label>
          {error && <p className="field-error">{error}</p>}
          <button className="primary-button full-button" disabled={loading} type="submit">
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </section>
    </main>
  );
}

function EstimatorView(props: any) {
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
    jobCosts,
    setJobCosts,
    setTaxEnabled,
    setTaxRate
  } = props;

  return (
    <div className="page-grid">
      <section className="panel estimator-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Estimator</p>
            <h2>Glass line item</h2>
          </div>
          <span className="rate-pill">Markup {measurement(settings.markupMultiplier)}x</span>
        </div>

        <div className="input-grid">
          <label>
            Width in inches
            <input
              inputMode="decimal"
              onChange={(event: any) => updateDraft("width", event.target.value)}
              placeholder="36 1/2"
              type="text"
              value={draftLine.width}
            />
          </label>
          <label>
            Height in inches
            <input
              inputMode="decimal"
              onChange={(event: any) => updateDraft("height", event.target.value)}
              placeholder="48 3/4"
              type="text"
              value={draftLine.height}
            />
          </label>
          <label>
            Quantity
            <input
              min="1"
              onChange={(event: any) => updateDraft("quantity", event.target.value)}
              placeholder="1"
              step="1"
              type="number"
              value={draftLine.quantity}
            />
          </label>
        </div>

        <div className="checkbox-section">
          <div className="section-label">Glass specifications</div>
          <div className="checkbox-grid">
            {settings.glassSpecs.map((spec: GlassSpec) => (
              <label className="check-option" key={spec.id}>
                <input
                  checked={draftLine.specIds.includes(spec.id)}
                  onChange={() => toggleDraftSpec(spec.id)}
                  type="checkbox"
                />
                <span>{spec.name}</span>
                <strong>{money(spec.pricePerSqFt)}/sq ft</strong>
              </label>
            ))}
          </div>
        </div>

        <div className="checkbox-section">
          <div className="section-label">Line job costs</div>
          <div className="input-grid two">
            <label>
              Labor hours
              <input
                min="0"
                onChange={(event: any) => updateDraft("laborHours", event.target.value)}
                placeholder="0"
                step="0.25"
                type="number"
                value={draftLine.laborHours}
              />
            </label>
            <label>
              Scaffolding hours
              <input
                min="0"
                onChange={(event: any) => updateDraft("scaffoldingHours", event.target.value)}
                placeholder="0"
                step="0.25"
                type="number"
                value={draftLine.scaffoldingHours}
              />
            </label>
          </div>
        </div>

        {lineError && <p className="field-error">{lineError}</p>}

        <button className="primary-button" onClick={addLine} type="button">
          Add line item
        </button>

        <EstimateLines
          estimateLines={estimateLines}
          removeLine={removeLine}
          settings={settings}
          totals={totals}
        />

        <JobLevelCostsSection
          jobCosts={jobCosts}
          setJobCosts={setJobCosts}
          settings={settings}
          totals={totals}
        />

        <EstimateAddOnsSection
          selectedAddOns={selectedAddOns}
          settings={settings}
          toggleAddOn={toggleAddOn}
          totals={totals}
        />
      </section>

      <aside className="summary-column">
        <section className="panel">
          <div className="section-heading compact">
            <div>
              <p className="eyebrow">Secure record</p>
              <h2>Save Estimate</h2>
            </div>
          </div>
          <div className="save-estimate-form">
            <label>
              Estimate name
              <input
                onChange={(event: any) => setEstimateName(event.target.value)}
                placeholder="Kitchen window replacement"
                type="text"
                value={estimateName}
              />
            </label>
            <label>
              Customer name
              <input
                onChange={(event: any) => setCustomerName(event.target.value)}
                placeholder="Customer or job name"
                type="text"
                value={customerName}
              />
            </label>
            {saveError && <p className="field-error">{saveError}</p>}
            {saveMessage && <p className="success-copy">{saveMessage}</p>}
            <button className="secondary-button" onClick={saveEstimate} type="button">
              Save estimate
            </button>
          </div>
        </section>

        <EstimateSummary
          settings={settings}
          taxEnabled={taxEnabled}
          taxRate={taxRate}
          totals={totals}
          setTaxEnabled={setTaxEnabled}
          setTaxRate={setTaxRate}
        />
      </aside>
    </div>
  );
}

function EstimateLines({ estimateLines, removeLine, settings, totals }: any) {
  return (
    <section className="line-list">
      <div className="section-heading compact">
        <div>
          <p className="eyebrow">Estimate</p>
          <h2>Glass items</h2>
        </div>
        <span className="muted">{estimateLines.length} line(s)</span>
      </div>

      {!estimateLines.length ? (
        <div className="empty-state">Add the first glass line item to begin the estimate.</div>
      ) : (
        <div className="line-card-stack">
          {totals.lineCalculations.map((item: any, index: number) => (
            <article className="line-breakdown-card" key={item.line.id}>
              <div className="line-breakdown-header">
                <div>
                  <p className="eyebrow">Line {index + 1}</p>
                  <h3>
                    {measurement(item.line.width)} x {measurement(item.line.height)} in
                    <span>Qty {measurement(item.line.quantity)}</span>
                  </h3>
                </div>
                <button
                  className="ghost-button small"
                  onClick={() => removeLine(item.line.id)}
                  type="button"
                >
                  Remove
                </button>
              </div>

              <div className="breakdown-grid">
                <div className="breakdown-block">
                  <h4>Glass</h4>
                  <SummaryRow label="Width" value={`${measurement(item.line.width)} in`} small />
                  <SummaryRow label="Height" value={`${measurement(item.line.height)} in`} small />
                  <SummaryRow label="Quantity" value={measurement(item.line.quantity)} small />
                  <SummaryRow label="Square footage each" value={`${measurement(item.unitSqFt)} sq ft`} small />
                  <SummaryRow label="Square footage total" value={`${measurement(item.totalSqFt)} sq ft`} small />
                  <SummaryRow label="Raw glass / sq ft" value={money(item.rawGlassPricePerSqFt)} small />
                  <SummaryRow label="Markup multiplier" value={`${measurement(item.markupMultiplier)}x`} small />
                  <SummaryRow
                    label="Glass / sq ft after markup"
                    value={money(item.glassPricePerSqFtAfterMarkup)}
                    small
                  />
                  <SummaryRow label="Glass total after markup" value={money(item.glassTotalAfterMarkup)} small />
                </div>

                <div className="breakdown-block">
                  <h4>Selected specs</h4>
                  {item.selectedSpecs.length ? (
                    <div className="spec-chip-list">
                      {item.selectedSpecs.map((spec: GlassSpec) => (
                        <span className="spec-chip" key={spec.id}>
                          {spec.name} {money(spec.pricePerSqFt)}/sq ft
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="muted tight-copy">No specs selected.</p>
                  )}
                </div>

                <div className="breakdown-block">
                  <h4>Job costs</h4>
                  <JobCostRow label="Labor" item={item.jobCosts.labor} />
                  <JobCostRow label="Scaffolding" item={item.jobCosts.scaffolding} />
                  <SummaryRow label="Line job costs" value={money(item.lineJobCostsTotal)} small />
                </div>

                <div className="breakdown-block">
                  <h4>Line total</h4>
                  <SummaryRow label="Glass after markup" value={money(item.glassTotalAfterMarkup)} small />
                  <SummaryRow label="Labor" value={money(item.jobCosts.labor.total)} small />
                  <SummaryRow label="Scaffolding" value={money(item.jobCosts.scaffolding.total)} small />
                  <SummaryRow label="Final line total" value={money(item.lineItemTotal)} small />
                </div>
              </div>

              <div className="line-final-total">
                <span>Final line item total</span>
                <strong>{money(item.lineItemTotal)}</strong>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function JobLevelCostsSection({ jobCosts, setJobCosts, settings, totals }: any) {
  function patchJobCosts(patch: Partial<EstimateJobCosts>) {
    setJobCosts((current: EstimateJobCosts) => ({ ...current, ...patch }));
  }

  return (
    <section className="embedded-estimate-section">
      <div className="section-heading compact">
        <div>
          <p className="eyebrow">Job level</p>
          <h2>Job Costs</h2>
        </div>
      </div>

      <div className="input-grid two">
        <label>
          Logistics hours
          <input
            min="0"
            onChange={(event: any) => patchJobCosts({ logisticsHours: event.target.value })}
            placeholder="0"
            step="0.25"
            type="number"
            value={jobCosts.logisticsHours}
          />
        </label>
        <label>
          Disposal hours
          <input
            min="0"
            onChange={(event: any) => patchJobCosts({ disposalHours: event.target.value })}
            placeholder="0"
            step="0.25"
            type="number"
            value={jobCosts.disposalHours}
          />
        </label>
      </div>

      <div className="summary-lines job-cost-preview">
        <SummaryRow
          label={`Logistics @ ${money(settings.jobCosts.logisticsHourlyRate)}/hr`}
          value={money(totals.logisticsTotal)}
          small
        />
        <SummaryRow
          label={`Disposal @ ${money(settings.jobCosts.disposalHourlyRate)}/hr`}
          value={money(totals.disposalTotal)}
          small
        />
      </div>
    </section>
  );
}

function EstimateAddOnsSection({ selectedAddOns, settings, toggleAddOn, totals }: any) {
  return (
    <section className="embedded-estimate-section">
      <div className="section-heading compact">
        <div>
          <p className="eyebrow">Estimate level</p>
          <h2>Add-ons</h2>
        </div>
      </div>
      <div className="checkbox-list">
        {settings.addOns.length ? (
          settings.addOns.map((addOn: AddOn) => {
            const calculated = calculateAddOn(addOn, totals.totalSqFt, totals.totalQuantity);
            return (
              <label className="check-option stacked" key={addOn.id}>
                <input
                  checked={selectedAddOns.includes(addOn.id)}
                  onChange={() => toggleAddOn(addOn.id)}
                  type="checkbox"
                />
                <span>
                  {addOn.name}
                  <small>{costTypeLabels[addOn.costType]} - {calculated.basis}</small>
                </span>
                <strong>{money(calculated.total)}</strong>
              </label>
            );
          })
        ) : (
          <div className="empty-state tight">No add-ons are configured.</div>
        )}
      </div>
    </section>
  );
}

function JobCostRow({ label, item }: any) {
  return (
    <SummaryRow
      label={`${label}: ${measurement(item.hours)} hr x ${money(item.rate)}/hr`}
      value={money(item.total)}
      small
    />
  );
}

function EstimateSummary({ settings, taxEnabled, taxRate, totals, setTaxEnabled, setTaxRate }: any) {
  return (
    <section className="summary-card">
      <div className="section-heading compact">
        <div>
          <p className="eyebrow">Customer estimate</p>
          <h2>Total</h2>
        </div>
      </div>

      <div className="summary-lines">
        <SummaryRow label="Total square footage" value={`${measurement(totals.totalSqFt)} sq ft`} />
        <SummaryRow label="Total quantity" value={measurement(totals.totalQuantity)} />
        <SummaryRow label="Raw glass subtotal" value={money(totals.glassSubtotal)} />
        <SummaryRow
          label={`Total glass after markup (${measurement(settings.markupMultiplier)}x)`}
          value={money(totals.glassTotalWithMarkup)}
        />
        <SummaryRow label="Labor total" value={money(totals.laborTotal)} />
        <SummaryRow label="Logistics total" value={money(totals.logisticsTotal)} />
        <SummaryRow label="Disposal total" value={money(totals.disposalTotal)} />
        <SummaryRow label="Scaffolding total" value={money(totals.scaffoldingTotal)} />
        <SummaryRow label="Add-ons total" value={money(totals.addOnsTotal)} />
        <SummaryRow label="Estimate subtotal" value={money(totals.preTaxTotal)} strong />
      </div>

      <div className="tax-controls">
        <label className="toggle-row">
          <input
            checked={taxEnabled}
            onChange={(event: any) => setTaxEnabled(event.target.checked)}
            type="checkbox"
          />
          Apply tax
        </label>
        <label>
          Tax rate (%)
          <input
            min="0"
            onChange={(event: any) => setTaxRate(event.target.value)}
            step="0.01"
            type="number"
            value={taxRate}
          />
        </label>
      </div>

      <div className="grand-total">
        <span>Grand total</span>
        <strong>{money(totals.grandTotal)}</strong>
      </div>
      {taxEnabled && <p className="muted tight-copy">Includes {money(totals.taxAmount)} tax.</p>}
    </section>
  );
}

function SummaryRow({ label, value, small = false, strong = false }: any) {
  return (
    <div className={`summary-row ${small ? "small" : ""} ${strong ? "strong" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function normalizeBreakdownJobCosts(item: any) {
  const empty = { hours: 0, rate: 0, total: 0 };
  const jobCosts = item.jobCosts || {};
  return {
    labor: { ...empty, ...(jobCosts.labor || {}) },
    scaffolding: { ...empty, ...(jobCosts.scaffolding || {}) }
  };
}

function savedEstimateJobCosts(estimate: SavedEstimate, settings: PricingSettings) {
  const savedSettings = estimate.pricingSnapshot || settings;
  const rates = savedSettings.jobCosts || fallbackSettings.jobCosts;
  const savedBreakdowns = Array.isArray(estimate.lineCalculations) ? estimate.lineCalculations : [];
  const jobCosts = estimate.jobCosts || {};
  const legacyLogisticsHours = savedBreakdowns.reduce(
    (total: number, item: any) => total + normalizeNumber(item.jobCosts?.logistics?.hours ?? 0),
    0
  );
  const legacyDisposalHours = savedBreakdowns.reduce(
    (total: number, item: any) => total + normalizeNumber(item.jobCosts?.disposal?.hours ?? 0),
    0
  );
  const logisticsRate = normalizeNumber(rates.logisticsHourlyRate ?? 0);
  const disposalRate = normalizeNumber(rates.disposalHourlyRate ?? 0);
  const logisticsTotal = normalizeNumber(estimate.totals?.logisticsTotal ?? 0);
  const disposalTotal = normalizeNumber(estimate.totals?.disposalTotal ?? 0);
  const logisticsHours =
    normalizeNumber(jobCosts.logisticsHours ?? 0) ||
    legacyLogisticsHours ||
    (logisticsRate > 0 ? logisticsTotal / logisticsRate : 0);
  const disposalHours =
    normalizeNumber(jobCosts.disposalHours ?? 0) ||
    legacyDisposalHours ||
    (disposalRate > 0 ? disposalTotal / disposalRate : 0);

  return {
    logistics: {
      hours: logisticsHours,
      rate: logisticsRate,
      total: logisticsTotal || logisticsHours * logisticsRate
    },
    disposal: {
      hours: disposalHours,
      rate: disposalRate,
      total: disposalTotal || disposalHours * disposalRate
    }
  };
}

function savedEstimateAddOns(estimate: SavedEstimate, settings: PricingSettings) {
  if (Array.isArray(estimate.addOnTotals)) return estimate.addOnTotals;

  const savedBreakdowns = Array.isArray(estimate.lineCalculations) ? estimate.lineCalculations : [];
  const legacyLineAddOns = savedBreakdowns.flatMap((item: any) =>
    Array.isArray(item.addOnTotals) ? item.addOnTotals : []
  );
  if (legacyLineAddOns.length) return legacyLineAddOns;

  const savedSettings = estimate.pricingSnapshot || settings;
  if (Array.isArray(estimate.selectedAddOns) && estimate.selectedAddOns.length) {
    return savedSettings.addOns
      .filter((addOn) => estimate.selectedAddOns?.includes(addOn.id))
      .map((addOn) => calculateAddOn(addOn, estimate.totals.totalSqFt, estimate.totals.totalQuantity));
  }

  return [];
}

function savedLineBreakdowns(estimate: SavedEstimate, settings: PricingSettings) {
  const savedSettings = estimate.pricingSnapshot || settings;
  const savedBreakdowns = Array.isArray(estimate.lineCalculations) ? estimate.lineCalculations : [];
  const sourceLines = savedBreakdowns.length
    ? savedBreakdowns.map((item: any) => item.line)
    : (Array.isArray(estimate.lines) ? estimate.lines : []);

  return sourceLines.map((line: EstimateLine, index: number) => {
    const fallback = calculateLine(line, savedSettings);
    const saved = savedBreakdowns[index] || {};
    const jobCosts = normalizeBreakdownJobCosts({ ...fallback, ...saved });
    const lineJobCostsTotal = jobCosts.labor.total + jobCosts.scaffolding.total;
    const glassTotalAfterMarkup = Number.isFinite(saved.glassTotalAfterMarkup)
      ? saved.glassTotalAfterMarkup
      : fallback.glassTotalAfterMarkup;

    return {
      ...fallback,
      ...saved,
      line,
      selectedSpecs: Array.isArray(saved.selectedSpecs) ? saved.selectedSpecs : fallback.selectedSpecs,
      addOnTotals: [],
      addOnsTotal: 0,
      jobCosts,
      lineJobCostsTotal,
      glassTotalAfterMarkup,
      lineItemTotal: glassTotalAfterMarkup + lineJobCostsTotal
    };
  });
}

function SavedEstimateBreakdown({ estimate, settings }: any) {
  const lines = savedLineBreakdowns(estimate, settings);
  const savedJobCosts = savedEstimateJobCosts(estimate, settings);
  const savedAddOns = savedEstimateAddOns(estimate, settings);

  return (
    <details className="saved-breakdown">
      <summary>View Full Breakdown</summary>
      {!lines.length ? (
        <div className="empty-state tight">This older estimate does not include line item details.</div>
      ) : (
        <div className="line-card-stack saved">
          {lines.map((item: any, index: number) => (
            <article className="line-breakdown-card" key={item.line.id || index}>
              <div className="line-breakdown-header">
                <div>
                  <p className="eyebrow">Saved line {index + 1}</p>
                  <h3>
                    {measurement(item.line.width)} x {measurement(item.line.height)} in
                    <span>Qty {measurement(item.line.quantity)}</span>
                  </h3>
                </div>
                <strong>{money(item.lineItemTotal)}</strong>
              </div>

              <div className="breakdown-grid">
                <div className="breakdown-block">
                  <h4>Glass math</h4>
                  <SummaryRow label="Square footage each" value={`${measurement(item.unitSqFt)} sq ft`} small />
                  <SummaryRow label="Square footage total" value={`${measurement(item.totalSqFt)} sq ft`} small />
                  <SummaryRow label="Raw glass / sq ft" value={money(item.rawGlassPricePerSqFt)} small />
                  <SummaryRow label="Markup multiplier" value={`${measurement(item.markupMultiplier)}x`} small />
                  <SummaryRow label="Glass / sq ft after markup" value={money(item.glassPricePerSqFtAfterMarkup)} small />
                  <SummaryRow label="Glass total after markup" value={money(item.glassTotalAfterMarkup)} small />
                </div>

                <div className="breakdown-block">
                  <h4>Selected specs</h4>
                  {item.selectedSpecs.length ? (
                    <div className="spec-chip-list">
                      {item.selectedSpecs.map((spec: GlassSpec) => (
                        <span className="spec-chip" key={spec.id}>
                          {spec.name} {money(spec.pricePerSqFt)}/sq ft
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="muted tight-copy">No specs selected.</p>
                  )}
                </div>

                <div className="breakdown-block">
                  <h4>Job costs</h4>
                  <JobCostRow label="Labor" item={item.jobCosts.labor} />
                  <JobCostRow label="Scaffolding" item={item.jobCosts.scaffolding} />
                  <SummaryRow label="Line job costs" value={money(item.lineJobCostsTotal)} small />
                </div>

                <div className="breakdown-block">
                  <h4>Line total</h4>
                  <SummaryRow label="Glass after markup" value={money(item.glassTotalAfterMarkup)} small />
                  <SummaryRow label="Labor" value={money(item.jobCosts.labor.total)} small />
                  <SummaryRow label="Scaffolding" value={money(item.jobCosts.scaffolding.total)} small />
                  <SummaryRow label="Final line total" value={money(item.lineItemTotal)} small />
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      <div className="summary-lines saved-total-block">
        <h4>Job Costs</h4>
        <JobCostRow label="Logistics" item={savedJobCosts.logistics} />
        <JobCostRow label="Disposal" item={savedJobCosts.disposal} />
      </div>

      <div className="summary-lines saved-total-block">
        <h4>Estimate Add-ons</h4>
        {savedAddOns.length ? (
          savedAddOns.map((entry: AddOnTotal, index: number) => (
            <SummaryRow
              key={`${entry.addOn.id}-${index}`}
              label={`${entry.addOn.name} (${costTypeLabels[entry.addOn.costType]})`}
              value={money(entry.total)}
              small
            />
          ))
        ) : (
          <p className="muted tight-copy">No estimate-level add-ons.</p>
        )}
      </div>

      <div className="summary-lines saved-total-block">
        <SummaryRow label="Total glass after markup" value={money(estimate.totals.glassTotalWithMarkup)} />
        <SummaryRow label="Total labor" value={money(estimate.totals.laborTotal)} />
        <SummaryRow label="Total logistics" value={money(estimate.totals.logisticsTotal)} />
        <SummaryRow label="Total disposal" value={money(estimate.totals.disposalTotal)} />
        <SummaryRow label="Total scaffolding" value={money(estimate.totals.scaffoldingTotal || 0)} />
        <SummaryRow label="Total add-ons" value={money(estimate.totals.addOnsTotal)} />
        <SummaryRow label="Grand total" value={money(estimate.totals.grandTotal)} strong />
      </div>
    </details>
  );
}

function SavedEstimatesView({ deleteEstimate, estimates, isAdmin, refreshEstimates, settings }: any) {
  return (
    <section className="panel max-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Estimates</p>
          <h2>Saved Estimates</h2>
        </div>
        <button className="secondary-button compact-button" onClick={refreshEstimates} type="button">
          Refresh
        </button>
      </div>

      {!estimates.length ? (
        <div className="empty-state">No saved estimates yet.</div>
      ) : (
        <div className="estimate-card-grid">
          {estimates.map((estimate: SavedEstimate) => (
            <article className="estimate-card" key={estimate.id}>
              <div>
                <p className="eyebrow">{estimate.customerName || "Customer estimate"}</p>
                <h3>{estimate.name}</h3>
                <p className="muted">
                  {formatDate(estimate.createdAt)} by {estimate.createdByName}
                </p>
              </div>
              <div className="estimate-metrics">
                <SummaryRow label="Glass with markup" value={money(estimate.totals.glassTotalWithMarkup)} />
                <SummaryRow label="Add-ons" value={money(estimate.totals.addOnsTotal)} />
                <SummaryRow label="Labor" value={money(estimate.totals.laborTotal)} />
                <SummaryRow label="Logistics" value={money(estimate.totals.logisticsTotal)} />
                <SummaryRow label="Disposal" value={money(estimate.totals.disposalTotal)} />
                <SummaryRow label="Scaffolding" value={money(estimate.totals.scaffoldingTotal || 0)} />
                <SummaryRow label="Grand total" value={money(estimate.totals.grandTotal)} strong />
              </div>
              <p className="muted tight-copy">
                {measurement(estimate.totals.totalSqFt)} sq ft across {measurement(estimate.totals.totalQuantity)} item(s)
              </p>
              <SavedEstimateBreakdown estimate={estimate} settings={settings} />
              {isAdmin && (
                <button className="ghost-button" onClick={() => deleteEstimate(estimate.id)} type="button">
                  Delete estimate
                </button>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function AdminView(props: any) {
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
    updateJobCostRate
  } = props;

  return (
    <div className="admin-layout">
      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Pricing Settings</p>
            <h2>Glass Specs</h2>
          </div>
          <button className="primary-button compact-button" onClick={saveAdminSettings} type="button">
            {adminStatus === "saving" ? "Saving..." : "Save settings"}
          </button>
        </div>

        {adminMessage && (
          <div className={`status-message ${adminStatus === "error" ? "error" : "success"}`}>
            {adminMessage}
          </div>
        )}

        <div className="settings-table">
          <div className="settings-row header">
            <span>Specification</span>
            <span>Price per square foot</span>
          </div>
          {adminSettings.glassSpecs.map((spec: GlassSpec) => (
            <div className="settings-row" key={spec.id}>
              <label>
                Name
                <input
                  onChange={(event: any) => updateAdminGlassSpec(spec.id, "name", event.target.value)}
                  type="text"
                  value={spec.name}
                />
              </label>
              <label>
                Price / sq ft
                <input
                  min="0"
                  onChange={(event: any) =>
                    updateAdminGlassSpec(spec.id, "pricePerSqFt", event.target.value)
                  }
                  step="0.01"
                  type="number"
                  value={spec.pricePerSqFt}
                />
              </label>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="section-heading compact">
          <div>
            <p className="eyebrow">Markup</p>
            <h2>Estimate Settings</h2>
          </div>
        </div>
        <div className="input-grid two">
          <label>
            Markup multiplier
            <input
              min="0.01"
              onChange={(event: any) =>
                setAdminSettings((current: PricingSettings) => ({
                  ...current,
                  markupMultiplier: normalizeNumber(event.target.value)
                }))
              }
              step="0.01"
              type="number"
              value={adminSettings.markupMultiplier}
            />
          </label>
          <label>
            Default tax rate (%)
            <input
              min="0"
              onChange={(event: any) =>
                setAdminSettings((current: PricingSettings) => ({
                  ...current,
                  defaultTaxRate: normalizeNumber(event.target.value)
                }))
              }
              step="0.01"
              type="number"
              value={adminSettings.defaultTaxRate}
            />
          </label>
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Extras</p>
            <h2>Add-ons</h2>
          </div>
          <button className="secondary-button compact-button" onClick={addAdminAddOn} type="button">
            Add add-on
          </button>
        </div>

        <div className="settings-table">
          <div className="settings-row header add-on">
            <span>Name</span>
            <span>Cost</span>
            <span>Cost type</span>
            <span></span>
          </div>
          {adminSettings.addOns.map((addOn: AddOn) => (
            <div className="settings-row add-on" key={addOn.id}>
              <label>
                Name
                <input
                  onChange={(event: any) => updateAdminAddOn(addOn.id, "name", event.target.value)}
                  type="text"
                  value={addOn.name}
                />
              </label>
              <label>
                Cost
                <input
                  min="0"
                  onChange={(event: any) => updateAdminAddOn(addOn.id, "cost", event.target.value)}
                  step="0.01"
                  type="number"
                  value={addOn.cost}
                />
              </label>
              <label>
                Cost type
                <select
                  onChange={(event: any) => updateAdminAddOn(addOn.id, "costType", event.target.value)}
                  value={addOn.costType}
                >
                  <option value="flat">Flat fee</option>
                  <option value="per_sq_ft">Per square foot</option>
                  <option value="per_item">Per item/quantity</option>
                </select>
              </label>
              <button className="ghost-button" onClick={() => removeAdminAddOn(addOn.id)} type="button">
                Remove
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="section-heading compact">
          <div>
            <p className="eyebrow">Hourly rates</p>
            <h2>Job Cost Rates</h2>
          </div>
        </div>

        <div className="input-grid">
          <label>
            Labor hourly rate
            <input
              min="0"
              onChange={(event: any) => updateJobCostRate("laborHourlyRate", event.target.value)}
              step="0.01"
              type="number"
              value={adminSettings.jobCosts.laborHourlyRate ?? 0}
            />
          </label>
          <label>
            Logistics hourly rate
            <input
              min="0"
              onChange={(event: any) => updateJobCostRate("logisticsHourlyRate", event.target.value)}
              step="0.01"
              type="number"
              value={adminSettings.jobCosts.logisticsHourlyRate ?? 0}
            />
          </label>
          <label>
            Disposal hourly rate
            <input
              min="0"
              onChange={(event: any) => updateJobCostRate("disposalHourlyRate", event.target.value)}
              step="0.01"
              type="number"
              value={adminSettings.jobCosts.disposalHourlyRate ?? 0}
            />
          </label>
          <label>
            Scaffolding hourly rate
            <input
              min="0"
              onChange={(event: any) => updateJobCostRate("scaffoldingHourlyRate", event.target.value)}
              step="0.01"
              type="number"
              value={adminSettings.jobCosts.scaffoldingHourlyRate ?? 0}
            />
          </label>
        </div>
      </section>
    </div>
  );
}

function TeamAccessView(props: any) {
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

  return (
    <div className="admin-layout">
      <section className="panel">
        <div className="section-heading compact">
          <div>
            <p className="eyebrow">Access Control</p>
            <h2>Create Team Member</h2>
          </div>
        </div>
        <div className="input-grid two">
          <label>
            Name
            <input
              onChange={(event: any) => setTeamDraft((current: any) => ({ ...current, name: event.target.value }))}
              type="text"
              value={teamDraft.name}
            />
          </label>
          <label>
            Email
            <input
              onChange={(event: any) => setTeamDraft((current: any) => ({ ...current, email: event.target.value }))}
              type="email"
              value={teamDraft.email}
            />
          </label>
          <label>
            Temporary password
            <input
              onChange={(event: any) => setTeamDraft((current: any) => ({ ...current, password: event.target.value }))}
              type="password"
              value={teamDraft.password}
            />
          </label>
          <label>
            Role
            <select
              onChange={(event: any) => setTeamDraft((current: any) => ({ ...current, role: event.target.value }))}
              value={teamDraft.role}
            >
              <option value="team_member">Team Member</option>
              <option value="admin">Admin</option>
            </select>
          </label>
        </div>
        {teamError && <p className="field-error">{teamError}</p>}
        {teamStatus && <p className="success-copy">{teamStatus}</p>}
        <button className="primary-button" onClick={createTeamMember} type="button">
          Create access
        </button>
      </section>

      <section className="panel">
        <div className="section-heading compact">
          <div>
            <p className="eyebrow">Directory</p>
            <h2>Team Members</h2>
          </div>
        </div>
        <div className="settings-table">
          <div className="settings-row header team-row">
            <span>Name</span>
            <span>Email</span>
            <span>Role</span>
            <span>Status</span>
            <span>Password</span>
            <span></span>
          </div>
          {users.map((user: TeamUser) => (
            <div className="settings-row team-row" key={user.id}>
              <label>
                Name
                <input
                  onChange={(event: any) => patchTeamUser(user.id, { name: event.target.value })}
                  type="text"
                  value={user.name}
                />
              </label>
              <label>
                Email
                <input
                  onChange={(event: any) => patchTeamUser(user.id, { email: event.target.value })}
                  type="email"
                  value={user.email}
                />
              </label>
              <label>
                Role
                <select
                  onChange={(event: any) => patchTeamUser(user.id, { role: event.target.value })}
                  value={user.role}
                >
                  <option value="team_member">Team Member</option>
                  <option value="admin">Admin</option>
                </select>
              </label>
              <label className="toggle-row">
                <input
                  checked={user.active}
                  onChange={(event: any) => patchTeamUser(user.id, { active: event.target.checked })}
                  type="checkbox"
                />
                Active
              </label>
              <label>
                Reset password
                <input
                  onChange={(event: any) => patchTeamUser(user.id, { passwordReset: event.target.value })}
                  placeholder="Leave blank"
                  type="password"
                  value={user.passwordReset || ""}
                />
              </label>
              <div className="row-actions">
                <button className="secondary-button" onClick={() => updateTeamMember(user)} type="button">
                  Save
                </button>
                <button className="ghost-button" onClick={() => deleteTeamMember(user.id)} type="button">
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
