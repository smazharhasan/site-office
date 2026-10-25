"""Several projects in one workspace (a builder runs many sites; an owner may build a second house).

Each person works in one project at a time and the choice stays with them. Build progress,
the store, attendance, the diary, inspections, snags, water, buying, bills, the budget and
"Ask the project" all follow the chosen project. Every project has its own store.

With only one project nothing is filtered, so a single-project workspace works exactly as
before. When the second project is added, the existing records are marked as belonging to
the first one.
"""

import frappe
from frappe import _
from frappe.utils import add_days, cint, cstr, flt, getdate, nowdate

KEY = "buildiary_project"

# documents that belong to a project (the header has a "project" field)
TAGGED = ("Supplier Quotation", "Purchase Order", "Purchase Receipt", "Purchase Invoice", "Payment Entry", "Stock Entry",
	"Site Diary", "Site Inspection", "Site Snag", "Site Attendance", "Petty Cash Entry", "Water Tank", "Water Tank Reading", "Water Tanker")

# the standard schedule for a new project: code, phase, start day, end day, after, English, Urdu, Arabic
STAGES = [
	("D1", "Design", 0, 30, [], "Design brief and concept plans", "ڈیزائن بریف اور ابتدائی نقشے", "ملخص التصميم والمخططات الأولية"),
	("D2", "Design", 30, 60, ["D1"], "Structural and MEP drawings", "اسٹرکچرل اور بجلی، پلمبنگ کے نقشے", "المخططات الإنشائية والكهروميكانيكية"),
	("A1", "Approval", 50, 75, ["D1"], "Building plan approval", "نقشے کی منظوری", "اعتماد رخصة البناء"),
	("G1", "Grey", 75, 90, ["A1", "D2"], "Mobilisation and excavation", "سائٹ کی تیاری اور کھدائی", "التجهيز والحفر"),
	("G2", "Grey", 90, 125, ["G1"], "Foundation, waterproofing and plinth", "بنیاد، واٹر پروفنگ اور پلنتھ", "الأساسات والعزل والميدة"),
	("G3", "Grey", 125, 185, ["G2"], "Ground-floor columns and roof slab", "گراؤنڈ فلور کے کالم اور چھت", "أعمدة وسقف الدور الأرضي"),
	("G4", "Grey", 185, 240, ["G3"], "First-floor columns and roof slab", "فرسٹ فلور کے کالم اور چھت", "أعمدة وسقف الدور الأول"),
	("G5", "Grey", 220, 270, ["G4"], "Block masonry, parapet and water tanks", "بلاک کی چنائی، پیراپٹ اور پانی کی ٹینکیاں", "البلوك والدروة وخزانات الماء"),
	("G6", "Grey", 270, 320, ["G5"], "Plaster and grey handover", "پلستر اور گرے اسٹرکچر کی حوالگی", "اللياسة وتسليم العظم"),
	("F1", "Finishing", 320, 365, ["G6"], "MEP first fix and window frames", "بجلی، پلمبنگ کی پہلی فٹنگ اور کھڑکیوں کی چوکھٹیں", "التأسيس الكهروميكانيكي وحلوق النوافذ"),
	("F2", "Finishing", 365, 440, ["F1"], "Flooring and wall tiles", "فرش اور دیواروں کی ٹائلیں", "الأرضيات وبلاط الجدران"),
	("F3", "Finishing", 400, 480, ["F1"], "Woodwork, kitchen and aluminium", "لکڑی کا کام، کچن اور ایلومینیم", "النجارة والمطبخ والألمنيوم"),
	("F4", "Finishing", 470, 530, ["F2"], "Paint, sanitary ware and lights", "رنگ، سینیٹری اور لائٹیں", "الدهان والأدوات الصحية والإنارة"),
	("H1", "Handover", 530, 550, ["F4", "F3"], "Snag list and handover", "خرابیوں کی فہرست اور حوالگی", "قائمة الملاحظات والتسليم"),
]
WEIGHT = {"Design": 2, "Approval": 1, "Grey": 6, "Finishing": 9, "Handover": 3}


# ---------------------------------------------------------------- which project
def _cache():
	if not hasattr(frappe.local, "buildiary_projects"):
		frappe.local.buildiary_projects = {}
	return frappe.local.buildiary_projects


def _live():
	"""Projects that are not cancelled, oldest first."""
	c = _cache()
	if "live" not in c:
		c["live"] = frappe.get_all("Project", filters={"status": ["!=", "Cancelled"]}, fields=["name", "project_name", "status"], order_by="creation asc", limit=500)
	return c["live"]


def multi():
	"""More than one project: lists show only the chosen project's records."""
	return len(_live()) > 1


def current():
	c = _cache()
	if "current" in c:
		return c["current"]
	live = {p.name: p for p in _live()}
	pick = None
	if frappe.session.user not in ("Guest", None):
		mine = frappe.defaults.get_user_default(KEY)
		if mine in live:
			pick = mine
	if not pick:
		d = frappe.db.get_single_value("Buildiary Settings", "default_project")
		if d in live:
			pick = d
	if not pick:
		opens = [p.name for p in _live() if p.status == "Open"]
		pick = opens[0] if opens else (next(iter(live), None))
	c["current"] = pick
	return pick


def store(project=None):
	"""The chosen project's store (warehouse)."""
	project = project or current()
	wh = frappe.db.get_value("Project", project, "buildiary_store") if project and frappe.db.has_column("Project", "buildiary_store") else None
	if wh:
		return wh
	s = frappe.db.get_single_value("Buildiary Settings", "site_warehouse")
	if s:
		return s
	co = frappe.db.get_single_value("Global Defaults", "default_company")
	return frappe.db.get_value("Warehouse", {"company": co, "is_group": 0, "warehouse_name": "Stores"}) or frappe.db.get_value("Warehouse", {"company": co, "is_group": 0})


def only(filters=None, field="project"):
	"""List filters, plus the chosen project when there is more than one."""
	f = dict(filters or {})
	if multi():
		f[field] = current()
	return f


def sql(alias=""):
	"""An SQL condition for the chosen project (empty with one project): ' and p.project = ...'."""
	if not multi():
		return ""
	a = f"{alias}." if alias else ""
	return f" and {a}project = {frappe.db.escape(current() or '')}"


# ---------------------------------------------------------------- new documents carry the project
def tag(doc, method=None):
	"""before_insert: a new buying, store or site document belongs to the person's project."""
	if not doc.meta.has_field("project"):
		return
	if not doc.get("project"):
		p = current()
		if p:
			doc.project = p
	for table in ("items", "accounts"):
		for row in doc.get(table) or []:
			if row.meta.has_field("project") and not row.get("project"):
				row.project = doc.project


# ---------------------------------------------------------------- the field app
def _owner():
	if "System Manager" not in frappe.get_roles():
		frappe.throw(_("Only the owner adds or changes projects."), frappe.PermissionError)


def brief():
	"""The projects for the switcher (open ones first)."""
	cur = current()
	rows = frappe.get_all("Project", filters={"status": ["!=", "Cancelled"]}, fields=["name", "project_name", "status", "percent_complete", "expected_start_date", "expected_end_date"],
		order_by="creation asc", limit=500)
	out = [{"name": r.name, "title": r.project_name, "status": r.status, "done": round(flt(r.percent_complete)), "start": r.expected_start_date, "end": r.expected_end_date,
		"current": r.name == cur} for r in rows]
	out.sort(key=lambda r: (r["status"] != "Open", 0))
	return out


@frappe.whitelist()
def projects():
	"""Every project with its figures, for the Projects screen."""
	rows = brief()
	from buildiary import build

	for r in rows:
		stages = build._stage_rows(r["name"])
		r["built"] = round(build._weighted(stages, "built"), 1) if stages else 0
		r["planned"] = round(build._weighted(stages, "planned"), 1) if stages else 0
		r["stages"] = len(stages)
		r["behind"] = sum(1 for s in stages if s["state"] == "behind")
		r["address"] = cstr(frappe.db.get_value("Project", r["name"], "notes"))
		r["store"] = store(r["name"])
	limit = _plan_limit()
	return {"rows": rows, "current": current(), "limit": limit, "open": sum(1 for r in rows if r["status"] == "Open"), "can_add": "System Manager" in frappe.get_roles()}


def _plan_limit():
	try:
		from buildiary.saas.tenant import _limit

		return _limit("projects")
	except Exception:
		return 0


@frappe.whitelist(methods=["POST"])
def switch(name):
	"""Work in another project (remembered for this person, on every phone)."""
	if not frappe.db.exists("Project", {"name": name, "status": ["!=", "Cancelled"]}):
		frappe.throw(_("This project is not available."))
	frappe.defaults.set_user_default(KEY, name)
	_cache().clear()
	return {"project": name, "project_name": frappe.db.get_value("Project", name, "project_name"), "store": store(name)}


def _parse(v):
	import json

	if isinstance(v, str):
		try:
			return json.loads(v)
		except ValueError:
			return {}
	return v or {}


def _company():
	return frappe.db.get_single_value("Global Defaults", "default_company") or frappe.get_all("Company", pluck="name", limit=1)[0]


def _lang():
	"""The stage names follow the owner's language (Arabic names for Arabic; English with Urdu beside it otherwise)."""
	return frappe.db.get_value("User", frappe.session.user, "language") or frappe.db.get_single_value("System Settings", "language") or "en"


def _first_store_and_backfill():
	"""Before the second project: the first project keeps the existing store and records."""
	live = _live()
	if len(live) != 1:
		return
	first = live[0].name
	wh = frappe.db.get_single_value("Buildiary Settings", "site_warehouse")
	if wh and not frappe.db.get_value("Project", first, "buildiary_store"):
		frappe.db.set_value("Project", first, "buildiary_store", wh, update_modified=False)
	if not frappe.db.get_single_value("Buildiary Settings", "default_project"):
		frappe.db.set_single_value("Buildiary Settings", "default_project", first)
	for dt in TAGGED:
		if frappe.db.table_exists(dt) and frappe.db.has_column(dt, "project"):
			frappe.db.sql(f"update `tab{dt}` set project = %s where coalesce(project, '') = ''", first)


def _new_store(title, co):
	parent = frappe.db.get_value("Warehouse", {"company": co, "is_group": 1, "parent_warehouse": ["in", ["", None]]}) \
		or frappe.db.get_value("Warehouse", {"company": co, "is_group": 1})
	base = f"{title[:60]} store"
	name, i = base, 2
	while frappe.db.exists("Warehouse", {"warehouse_name": name, "company": co}):
		name, i = f"{base} {i}", i + 1
	return frappe.get_doc({"doctype": "Warehouse", "warehouse_name": name, "company": co, "parent_warehouse": parent}).insert(ignore_permissions=True).name


def standard_schedule(project, start=None, end=None, lang=None):
	"""The usual stages of building a house (14 stages), spread from the project's start to its
	finish (about 18 months when no finish is given). The owner moves dates or adds stages in
	ERPNext (Project > Tasks)."""
	if frappe.db.count("Task", {"project": project}):
		return 0
	p = frappe.db.get_value("Project", project, ["expected_start_date", "expected_end_date"], as_dict=True) or {}
	start = getdate(start or p.get("expected_start_date") or nowdate())
	end = getdate(end or p.get("expected_end_date") or add_days(start, 550))
	k = max(30, (end - start).days) / 550.0
	lang = lang or _lang()
	names = {}
	phase_of = {"Design": "Design", "Approval": "Approvals", "Grey": "Grey structure", "Finishing": "Finishing", "Handover": "Handover"}
	for code, ph, a, b, _after, en, ur, ar in STAGES:
		title = ar if lang == "ar" else en
		t = frappe.get_doc({"doctype": "Task", "subject": f"{code} {title}", "project": project, "exp_start_date": add_days(start, int(a * k)), "exp_end_date": add_days(start, int(b * k)),
			"status": "Open", "task_weight": WEIGHT.get(ph, 1), "description": f"{ph} · {ur}"})
		if t.meta.has_field("buildiary_phase"):
			t.buildiary_phase = phase_of.get(ph)
		t.insert(ignore_permissions=True)
		names[code] = t.name
	for code, *_rest in STAGES:
		after = _rest[3]
		if after:
			t = frappe.get_doc("Task", names[code])
			for x in after:
				t.append("depends_on", {"task": names[x]})
			t.flags.ignore_permissions = True
			t.save()
	return len(names)


@frappe.whitelist(methods=["POST"])
def new(data):
	"""The owner adds a project: its own store, the standard schedule (optional), and it becomes
	the owner's current project."""
	_owner()
	d = frappe._dict(_parse(data))
	title = cstr(d.title).strip()
	if len(title) < 2:
		frappe.throw(_("Enter the project's name."))
	if len(title) > 80:
		frappe.throw(_("The project's name is too long."))
	if frappe.db.exists("Project", {"project_name": title}):
		frappe.throw(_("There is already a project called {0}.").format(title))
	start = getdate(d.start or nowdate())
	end = getdate(d.end) if d.end else add_days(start, 550 if cint(d.get("schedule", 1)) else 365)
	if end <= start:
		frappe.throw(_("The finish date must be after the start date."))
	co = _company()
	_first_store_and_backfill()
	p = frappe.get_doc({"doctype": "Project", "project_name": title, "company": co, "status": "Open", "is_active": "Yes", "expected_start_date": start, "expected_end_date": end,
		"percent_complete_method": "Task Weight", "notes": cstr(d.address).strip(), "estimated_costing": flt(d.budget), "cost_center": frappe.db.get_value("Company", co, "cost_center")})
	p.insert(ignore_permissions=True)
	p.db_set("buildiary_store", _new_store(title, co))
	n = standard_schedule(p.name, start, end) if cint(d.get("schedule", 1)) else 0
	frappe.defaults.set_user_default(KEY, p.name)
	_cache().clear()
	return {"name": p.name, "title": title, "stages": n}


@frappe.whitelist(methods=["POST"])
def add_stages(name):
	"""The usual stages for a project that has none yet."""
	_owner()
	if not frappe.db.exists("Project", name):
		frappe.throw(_("This project is not available."))
	n = standard_schedule(name)
	if not n:
		frappe.throw(_("This project already has stages."))
	return n


@frappe.whitelist(methods=["POST"])
def edit(name, data):
	"""Rename, change the address or dates, close a finished project or open it again."""
	_owner()
	d = frappe._dict(_parse(data))
	p = frappe.get_doc("Project", name)
	if d.get("title"):
		t = cstr(d.title).strip()[:80]
		if t != p.project_name and frappe.db.exists("Project", {"project_name": t, "name": ["!=", p.name]}):
			frappe.throw(_("There is already a project called {0}.").format(t))
		p.project_name = t
	if d.get("address") is not None:
		p.notes = cstr(d.address).strip()
	for k, f in (("start", "expected_start_date"), ("end", "expected_end_date")):
		if d.get(k):
			p.set(f, getdate(d[k]))
	if d.get("status") in ("Open", "Completed") and d.status != p.status:
		if d.status == "Open":
			n = _plan_limit()
			if n and frappe.db.count("Project", {"status": "Open"}) >= n:
				frappe.throw(_("Your plan allows {0} open project(s). Close another one or move to a bigger plan in Plan & billing.").format(n), title=_("Plan limit"))
		p.status = d.status
	p.flags.ignore_permissions = True
	p.save()
	_cache().clear()
	return {"name": p.name, "status": p.status}
