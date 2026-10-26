"""A sample project (fictional names and figures) for a trial with sample data, the website's screenshots,
and anyone who wants to see Buildiary with data in it:

    bench --site <workspace> execute buildiary.saas.demo.make --kwargs "{'country': 'Saudi Arabia', 'lang': 'ar'}"

It follows the company's country: a Pakistani house in rupees, feet and local names; a Gulf villa in riyals or
dirhams, metres and Gulf names (with a skip for debris); or an international house in metres for everyone else.
Amounts follow the company's currency. Safe to run once on a fresh workspace; it does nothing if a sample
project is already there."""

import random

import frappe
from frappe.utils import add_days, flt, getdate, nowdate, nowtime

from buildiary.migration import old_app

PROJECT = "Al Noor Residence"
PROJECTS = {"pk": ("Al Noor Residence", "Plot 12, Street 4, Sample Town"), "gulf": ("Al Noor Villa", "Villa 12, Street 4, Sample District"),
	"intl": ("Maple Grove House", "12 Sample Street, Sample Town")}
RULES = ("po_needs_final_quotation", "require_dn_scan", "require_receiver_photo", "require_bill_scan", "require_payment_proof", "pay_only_due",
	"require_attendance_photo", "card_for_store", "card_for_receiving", "card_for_petty_cash", "petty_bill_required", "petty_needs_budget")

SOUTH_ASIA = ("Pakistan", "India", "Bangladesh", "Sri Lanka", "Nepal", "Afghanistan")
GULF = ("Saudi Arabia", "United Arab Emirates", "Qatar", "Kuwait", "Bahrain", "Oman")
# about how many of each money make one US dollar (the sample's figures are written in rupees at about 280 to the dollar)
USD_RATE = {"PKR": 280, "INR": 84, "BDT": 120, "LKR": 300, "NPR": 135, "AFN": 70, "SAR": 3.75, "AED": 3.67, "QAR": 3.64, "OMR": 0.385, "KWD": 0.307,
	"BHD": 0.376, "USD": 1, "EUR": 0.92, "GBP": 0.79, "CAD": 1.37, "AUD": 1.52, "NZD": 1.65, "CHF": 0.88, "SEK": 10.6, "NOK": 10.8, "DKK": 6.9,
	"PLN": 4.0, "TRY": 34, "EGP": 48, "JOD": 0.71, "IQD": 1310, "MAD": 10, "TND": 3.1, "DZD": 134, "ZAR": 18.5, "NGN": 1500, "KES": 129, "GHS": 15.5,
	"TZS": 2700, "UGX": 3700, "ETB": 120, "MYR": 4.7, "SGD": 1.35, "IDR": 15800, "PHP": 58, "THB": 36, "VND": 25000, "CNY": 7.2, "JPY": 150, "KRW": 1380,
	"HKD": 7.8, "BRL": 5.6, "MXN": 19.5, "ARS": 950, "CLP": 950, "COP": 4100, "PEN": 3.7, "ILS": 3.7, "RUB": 92, "UAH": 41, "KZT": 480, "UZS": 12700}
RICH = ("USD", "EUR", "GBP", "CAD", "AUD", "NZD", "CHF", "SEK", "NOK", "DKK", "SGD", "JPY", "KRW", "HKD", "ILS")
# rupees to the company's money, roughly (kept for older calls)
SCALE = {"PKR": 1.0, "INR": 1.0, "SAR": 1 / 75.0, "AED": 1 / 76.0, "QAR": 1 / 77.0, "USD": 1 / 280.0}
# feet to metres for the sample's sand, crush, tiles and marble outside South Asia
METRIC = {"SND-RAVI": ("m3", 0.0283168), "CRS-34": ("m3", 0.0283168), "TIL-6060": ("m2", 0.092903), "MRB-WHT": ("m2", 0.092903)}


def variant(country=None):
	country = country or frappe.db.get_value("Company", frappe.db.get_single_value("Global Defaults", "default_company"), "country")
	return "pk" if country in SOUTH_ASIA else "gulf" if country in GULF else "intl"


def factors(cur, v):
	"""(materials, wages): rupee figures to this money, and to prices and wages there."""
	k = USD_RATE.get(cur, 1) / 280.0
	if v == "pk":
		return k, k
	if v == "gulf":
		return k * 1.15, k * 2.5
	return (k * 1.8, k * 10) if cur in RICH else (k * 1.3, k * 1.6)


def _k():
	co = frappe.db.get_single_value("Global Defaults", "default_company")
	cur = frappe.db.get_value("Company", co, "default_currency")
	return SCALE.get(cur, 1 / 75.0), co


def _qty(code, q, v):
	"""A quantity in the sample's units (feet) for this variant."""
	if v != "pk" and code in METRIC:
		return round(q * METRIC[code][1], 1)
	return q


def _r(v, k, step=1):
	x = flt(v) * k
	if k < 1:
		step = 0.05 if x < 10 else 0.5 if x < 50 else 1 if x < 200 else 5 if x < 5000 else 50
		return round(round(x / step) * step, 2)
	return round(x / step) * step if step else x


def _d(days):
	return str(add_days(nowdate(), days))


NAMES = {
	"pk": {
		"items": {},
		"suppliers": [("Madina Cement Traders", "Materials", "Bilal Ahmed"), ("Faisal Steel Store", "Materials", "Faisal Iqbal"), ("Al Noor Block Factory", "Materials", "Hamid Raza"),
			("Riverside Sand & Crush", "Materials", "Asif Khan"), ("Ravi Electric Co.", "Materials", "Usman Tariq"), ("City Pipes & Fittings", "Materials", "Kamran Ali"),
			("Star Builders", "Grey structure", "Ahmed Saeed"), ("Gulberg Tiles & Marble", "Finishing", "Nadeem Akhtar")],
		"phone": "0300-55{i:05d}",
	},
	"gulf": {
		"items": {"BLK-6": "Concrete block 20 cm (hollow)", "BLK-4": "Concrete block 15 cm", "SND-RAVI": "Washed sand", "CRS-34": "Aggregate 20 mm", "MRB-WHT": "White marble",
			"CND-1": "PVC conduit 25 mm", "PIPE-4": "uPVC drain pipe 110 mm"},
		"suppliers": [("Al Waha Cement Trading", "Materials", "Khalid Al Otaibi"), ("Gulf Rebar Trading", "Materials", "Rashid Khan"), ("Desert Block Factory", "Materials", "Majed Al Zahrani"),
			("Al Rimal Sand & Aggregates", "Materials", "Omar Farooq"), ("Noor Electrical Trading", "Materials", "Sami Haddad"), ("Al Madina Pipes & Fittings", "Materials", "Anwar Hussain"),
			("Al Bina Contracting", "Grey structure", "Yousef Al Qahtani"), ("Marmar Tiles & Marble", "Finishing", "Tariq Aziz"), ("Green Skip Services", "Waste removal", "Faisal Al Harbi")],
		"phone": "050-55{i:05d}",
	},
	"intl": {
		"items": {"BLK-6": "Concrete block 200 mm", "BLK-4": "Concrete block 150 mm", "SND-RAVI": "Washed sand", "CRS-34": "Aggregate 20 mm", "MRB-WHT": "White marble",
			"CND-1": "PVC conduit 25 mm", "PIPE-4": "PVC drain pipe 110 mm", "STL-12": "Rebar 12 mm", "STL-16": "Rebar 16 mm", "STL-10": "Rebar 10 mm"},
		"suppliers": [("Riverside Cement Supply", "Materials", "Daniel Moore"), ("Metro Steel & Rebar", "Materials", "Maria Lopez"), ("Northfield Block Works", "Materials", "Samuel Okafor"),
			("Granite Ridge Aggregates", "Materials", "Priya Nair"), ("Brightline Electrical", "Materials", "James Chen"), ("City Pipes & Fittings", "Materials", "Ahmed Hassan"),
			("Summit Builders", "Grey structure", "Lucas Silva"), ("Stone & Tile Gallery", "Finishing", "Anna Kowalski"), ("Clearway Waste Services", "Waste removal", "Tom Baker")],
		"phone": "020-55{i:05d}",
	},
}
SUPPLIER_ITEMS = [["CEM-OPC", "WPF-CHEM"], ["STL-10", "STL-12", "STL-16", "BND-WIRE"], ["BLK-6", "BLK-4"], ["SND-RAVI", "CRS-34"], ["CND-1"], ["PIPE-4", "PPR-25"], [], ["TIL-6060", "MRB-WHT"], []]
WORKERS = {
	"pk": [("Rafiq Ahmed", "Mistri", "Mason"), ("Shahid Mehmood", "Mistri", "Steel fixer"), ("Imran Ali", "Mistri", "Shuttering"), ("Nasir Hussain", "Group head", "Mason"),
		("Arif Khan", "Labour", ""), ("Zahid Iqbal", "Labour", ""), ("Sajid Ali", "Labour", ""), ("Waqas Ahmed", "Labour", ""), ("Fahad Hussain", "Labour", ""),
		("Bilal Akram", "Labour", ""), ("Tariq Mehmood", "Labour", ""), ("Junaid Khan", "Labour", ""), ("Kashif Ali", "Mistri", "Electrician"), ("Asad Raza", "Supervisor", "")],
	"gulf": [("Rafiq Ahmed", "Mistri", "Mason"), ("Shahid Mehmood", "Mistri", "Steel fixer"), ("Ramesh Kumar", "Mistri", "Shuttering"), ("Nasir Hussain", "Group head", "Mason"),
		("Arif Khan", "Labour", ""), ("Biju Thomas", "Labour", ""), ("Sajid Ali", "Labour", ""), ("Abdul Karim", "Labour", ""), ("Mohammed Rafi", "Labour", ""),
		("Suresh Babu", "Labour", ""), ("Tariq Mehmood", "Labour", ""), ("Junaid Khan", "Labour", ""), ("Kashif Ali", "Mistri", "Electrician"), ("Mahmoud Saleh", "Supervisor", "")],
	"intl": [("Carlos Mendes", "Mistri", "Mason"), ("John Mwangi", "Mistri", "Steel fixer"), ("Piotr Nowak", "Mistri", "Shuttering"), ("David Okoro", "Group head", "Mason"),
		("Ali Yilmaz", "Labour", ""), ("Samuel Adeyemi", "Labour", ""), ("Ravi Patel", "Labour", ""), ("Mark Wilson", "Labour", ""), ("Juan Perez", "Labour", ""),
		("Thomas Brown", "Labour", ""), ("Kevin Otieno", "Labour", ""), ("Luis Garcia", "Labour", ""), ("Ivan Petrov", "Mistri", "Electrician"), ("Sarah Collins", "Supervisor", "")],
}
ISSUED_TO = {"pk": ["Ustad Rafiq (mason)", "Shahid (steel fixer)", "Imran (shuttering)"], "gulf": ["Rafiq (mason)", "Shahid (steel fixer)", "Ramesh (shuttering)"],
	"intl": ["Carlos (mason)", "John (steel fixer)", "Piotr (shuttering)"]}
LABOUR_LINES = ("bud-01", "bud-02", "bud-03", "bud-04", "bud-05", "bud-14")


def data(k, v="pk", kw=None):
	"""The sample project in the old app's file format (what migration.old_app reads). k: rupees to the company's
	money for materials; kw: for labour and services."""
	kw = k if kw is None else kw
	N = NAMES[v]
	items = [
		("CEM-OPC", "Cement (OPC, 50 kg bag)", "bag", "Cement", 1450), ("STL-12", "Steel bar 12 mm (Grade 60)", "kg", "Steel", 265), ("STL-16", "Steel bar 16 mm (Grade 60)", "kg", "Steel", 262),
		("STL-10", "Steel bar 10 mm (Grade 60)", "kg", "Steel", 268), ("BLK-6", "Concrete block 6 in", "nos", "Blocks", 88), ("BLK-4", "Concrete block 4 in", "nos", "Blocks", 70),
		("SND-RAVI", "Sand (Ravi)", "cft", "Sand & crush", 95), ("CRS-34", "Crush 3/4 in", "cft", "Sand & crush", 165), ("BND-WIRE", "Binding wire", "kg", "Binding & fixing", 420),
		("SHT-PLY", "Shuttering plywood 18 mm", "nos", "Shuttering & formwork", 5200), ("WPF-CHEM", "Waterproofing chemical", "litre", "Admixtures & chemicals", 950),
		("CND-1", "PVC conduit 1 in", "nos", "Electrical conduits", 310), ("PIPE-4", "uPVC drain pipe 4 in", "nos", "Plumbing (grey)", 2400), ("PPR-25", "PPR pipe 25 mm", "nos", "Plumbing (grey)", 1150),
		("TIL-6060", "Porcelain floor tile 60x60", "sft", "Tiles & marble", 310), ("MRB-WHT", "White marble (Ziarat)", "sft", "Tiles & marble", 650), ("PNT-EMU", "Emulsion paint (white)", "litre", "Paint", 1100),
		("PUTTY", "Wall putty", "bag", "Paint", 1350), ("GLV", "Work gloves", "pair", "Safety (PPE)", 250), ("HLMT", "Safety helmet", "nos", "Safety (PPE)", 900),
	]
	out_items = []
	for c, n, u, cat, rate in items:
		n = N["items"].get(c, n)
		if v != "pk" and c in METRIC:
			u, f = METRIC[c]
			rate = rate / f
		out_items.append((c, n, u, cat, rate))
	cat_budget = {"Cement": "bud-06", "Steel": "bud-07", "Blocks": "bud-08", "Sand & crush": "bud-09", "Binding & fixing": "bud-07", "Shuttering & formwork": "bud-05",
		"Admixtures & chemicals": "bud-06", "Electrical conduits": "bud-10", "Plumbing (grey)": "bud-11", "Tiles & marble": "bud-12", "Paint": "bud-13", "Safety (PPE)": "bud-15"}
	kind = {"Tiles & marble": "Finishing materials", "Paint": "Finishing materials", "Safety (PPE)": "Safety (PPE)"}
	budget = [
		("bud-01", "Architect design fee", "Design & approvals", 1500000), ("bud-02", "MEP design", "Design & approvals", 400000), ("bud-03", "Grey service charges", "Service charges", 1800000),
		("bud-04", "Finishing service charges", "Service charges", 1800000), ("bud-05", "Grey labour", "Grey labour", 7200000), ("bud-06", "Cement", "Grey materials", 6000000),
		("bud-07", "Steel", "Grey materials", 8500000), ("bud-08", "Blocks", "Grey materials", 900000), ("bud-09", "Sand and crush", "Grey materials", 1400000),
		("bud-10", "Electrical material", "Grey materials", 600000), ("bud-11", "Plumbing material", "Grey materials", 700000), ("bud-12", "Tiles and marble", "Finishing materials", 6500000),
		("bud-13", "Paint material", "Finishing materials", 1200000), ("bud-14", "Finishing labour", "Finishing labour", 3500000), ("bud-15", "Site safety and consumables", "Site running costs", 300000),
		("bud-16", "Contingency (10%)", "Contingency", 4300000),
	]
	ms = [
		("D1", "Design brief and concept plans", "Design", -170, -140, []), ("D2", "Structural and MEP drawings", "Design", -140, -110, ["D1"]),
		("A1", "Building plan approval", "Approval", -120, -95, ["D1"]), ("G1", "Mobilisation and excavation", "Grey", -95, -80, ["A1", "D2"]),
		("G2", "Foundation, waterproofing and plinth", "Grey", -80, -45, ["G1"]), ("G3", "Ground-floor columns and roof slab", "Grey", -45, 15, ["G2"]),
		("G4", "First-floor columns and roof slab", "Grey", 15, 70, ["G3"]), ("G5", "Block masonry, parapet and water tanks", "Grey", 50, 100, ["G4"]),
		("G6", "Plaster and grey handover", "Grey", 100, 150, ["G5"]), ("F1", "MEP first fix and window frames", "Finishing", 150, 195, ["G6"]),
		("F2", "Flooring and wall tiles", "Finishing", 195, 270, ["F1"]), ("F3", "Woodwork, kitchen and aluminium", "Finishing", 230, 310, ["F1"]),
		("F4", "Paint, sanitary ware and lights", "Finishing", 300, 360, ["F2"]), ("H1", "Snag list and handover", "Handover", 360, 380, ["F4", "F3"]),
	]
	name, address = PROJECTS[v]
	return {
		"project": {"name": name, "address": address, "start": _d(-170), "end": _d(380)},
		"units": {"nos": "Nos", "bag": "Bag", "kg": "Kg", "cft": "Cubic Foot", "sft": "Square Foot", "litre": "Litre", "pair": "Pair", "m3": "Cubic Meter", "m2": "Square Meter"},
		"items": [{"code": c, "name": n, "unit": u, "category": cat, "kind": kind.get(cat, "Grey materials"), "phase": "Grey", "spec": n, "rate": _r(rate, k)} for c, n, u, cat, rate in out_items],
		"category_budget": cat_budget,
		"budget": [{"id": i, "name": n, "category": c, "amount": _r(a, kw if i in LABOUR_LINES else k)} for i, n, c, a in budget],
		"milestones": [{"code": c, "name": n, "phase": ph, "start": _d(a), "end": _d(b), "after": aft, "ur": ""} for c, n, ph, a, b, aft in ms],
		"suppliers": [{"name": n, "work": w, "contact": c, "phone": N["phone"].format(i=i), "items": SUPPLIER_ITEMS[i] if i < len(SUPPLIER_ITEMS) else []}
			for i, (n, w, c) in enumerate(N["suppliers"])],
		"payment_plan": [],
	}


_V = {"v": "pk", "name": PROJECT}


def make_cli(country=None, lang=None):
	"""For the console's set-up: the sample, with the real error printed if it fails (bench execute hides it)."""
	try:
		make(country=country, lang=lang)
	except Exception:
		frappe.db.rollback()
		print(frappe.get_traceback())
		print("SAMPLE FAILED")


def make(country=None, lang=None):
	co = frappe.db.get_single_value("Global Defaults", "default_company")
	cur = frappe.db.get_value("Company", co, "default_currency")
	v = variant(country)
	km, kw = factors(cur, v)
	if any(frappe.db.exists("Project", {"project_name": n}) for n, _a in PROJECTS.values()):
		print("The sample project is already here.")
		return
	_V.update(v=v, name=PROJECTS[v][0])
	random.seed(31)
	s = frappe.get_single("Buildiary Settings")
	keep = {f: s.get(f) for f in RULES}
	keep["face_check"] = s.face_check
	for f in RULES:
		frappe.db.set_single_value("Buildiary Settings", f, 0)
	frappe.db.set_single_value("Buildiary Settings", "face_check", "Off")
	frappe.clear_document_cache("Buildiary Settings", "Buildiary Settings")
	try:
		_fiscal_years(co)
		old_app.run(company=co, data=data(km, v, kw))
		from buildiary.setup import apply_settings

		apply_settings()
		wh = frappe.db.get_single_value("Buildiary Settings", "site_warehouse")
		if wh and frappe.db.has_column("Project", "buildiary_store"):
			frappe.db.set_value("Project", _project(), "buildiary_store", wh, update_modified=False)
		_progress()
		_buying(co, km)
		_people(co, kw)
		_water_and_cash(co, km)
		_quality()
		_debris(km)
		frappe.db.commit()
		if lang == "ar":
			localize_ar()
		print("SAMPLE PROJECT READY")
	finally:
		for f, val in keep.items():
			frappe.db.set_single_value("Buildiary Settings", f, val)
		frappe.clear_document_cache("Buildiary Settings", "Buildiary Settings")
		frappe.db.commit()


def _fiscal_years(co):
	"""Financial years from before the project's start to after its end."""
	month = 7 if frappe.db.get_value("Company", co, "country") == "Pakistan" else 1
	today = getdate(nowdate())
	for y in range(today.year - 2, today.year + 3):
		start = getdate(f"{y}-{month:02d}-01")
		end = add_days(getdate(f"{y + (1 if month > 1 else 1)}-{month:02d}-01"), -1)
		if frappe.db.sql("select name from `tabFiscal Year` where %s between year_start_date and year_end_date", start):
			continue
		name = f"{y}" if month == 1 else f"{y}-{y + 1}"
		if frappe.db.exists("Fiscal Year", name):
			name += "-" + co[:3]
		frappe.get_doc({"doctype": "Fiscal Year", "year": name, "year_start_date": start, "year_end_date": end, "companies": [{"company": co}]}).insert(ignore_permissions=True)


def _project():
	return frappe.db.get_value("Project", {"project_name": _V.get("name") or PROJECT})


def _sup_name(i):
	return NAMES[_V["v"]]["suppliers"][i][0]


def _progress():
	done = {"D1": 100, "D2": 100, "A1": 100, "G1": 100, "G2": 100, "G3": 62}
	for t in frappe.get_all("Task", filters={"project": _project()}, fields=["name", "subject"]):
		code = t.subject.split(" ")[0]
		pct = done.get(code)
		if pct is None:
			continue
		vals = {"progress": pct, "buildiary_reported": pct if code != "G3" else 70, "status": "Completed" if pct == 100 else "Working"}
		if pct == 100 or code == "G3":
			vals.update(buildiary_verified=pct, buildiary_verified_by="Administrator", buildiary_verified_on=nowdate())
		if pct == 100:
			vals["completed_on"] = nowdate()
		frappe.db.set_value("Task", t.name, vals, update_modified=False)


def _wh():
	return frappe.db.get_single_value("Buildiary Settings", "site_warehouse")


def _buying(co, k):
	from erpnext.accounts.doctype.payment_entry.payment_entry import get_payment_entry
	from erpnext.buying.doctype.purchase_order.purchase_order import make_purchase_receipt
	from erpnext.buying.doctype.supplier_quotation.supplier_quotation import make_purchase_order
	from erpnext.stock.doctype.purchase_receipt.purchase_receipt import make_purchase_invoice

	from buildiary.procurement import mark_final

	wh, project = _wh(), _project()
	sup = {n: frappe.db.get_value("Supplier", {"supplier_name": n}) for n in frappe.get_all("Supplier", pluck="supplier_name")}
	v = _V["v"]
	orders = [
		(_sup_name(0), [("CEM-OPC", 1800)], 1.0, "paid", -70),
		(_sup_name(1), [("STL-12", 9000), ("STL-16", 7000), ("STL-10", 3500), ("BND-WIRE", 250)], 0.85, "part", -60),
		(_sup_name(2), [("BLK-6", 12000), ("BLK-4", 5000)], 0.6, "billed", -30),
		(_sup_name(3), [("SND-RAVI", 6000), ("CRS-34", 5000)], 1.0, "paid", -55),
		(_sup_name(4), [("CND-1", 400)], 1.0, "billed", -20),
		(_sup_name(5), [("PIPE-4", 60), ("PPR-25", 150)], 0.0, "ordered", -8),
	]
	orders = [(n, [(c, _qty(c, q, v)) for c, q in lines], r, st, d) for n, lines, r, st, d in orders]
	for name, lines, received, state, days in orders:
		s = sup.get(name)
		if not s:
			continue
		rate = {i: frappe.db.get_value("Item", i, "valuation_rate") for i, _ in lines}
		sq = frappe.get_doc({"doctype": "Supplier Quotation", "supplier": s, "company": co, "transaction_date": _d(days - 5), "quotation_number": f"Q-{random.randint(100, 999)}", "project": project,
			"buildiary_payment_terms": "Balance on delivery", "buildiary_advance_percent": 0, "buildiary_delivery_time": "7 days",
			"items": [{"item_code": i, "qty": q, "rate": rate[i], "warehouse": wh, "project": project} for i, q in lines]})
		sq.insert(ignore_permissions=True)
		sq.submit()
		mark_final(sq.name)
		po = make_purchase_order(sq.name)
		po.transaction_date = _d(days)
		po.schedule_date = _d(days + 7)
		po.project = project
		for it in po.items:
			it.schedule_date = po.schedule_date
			it.project = project
		po.buildiary_site_address = "Plot 12, Street 4, Sample Town"
		po.insert(ignore_permissions=True)
		po.submit()
		if received <= 0:
			continue
		pr = make_purchase_receipt(po.name)
		pr.posting_date = _d(days + 4)
		pr.set_posting_time = 1
		pr.supplier_delivery_note = f"DN-{random.randint(1000, 9999)}"
		pr.buildiary_received_by = "Store keeper"
		pr.buildiary_vehicle = f"{'LES' if v == 'pk' else 'TRK'}-{random.randint(1000, 9999)}"
		for it in pr.items:
			it.qty = it.received_qty = round(it.qty * received, 1) if it.item_code in METRIC and v != "pk" else round(it.qty * received)
			it.project = project
		pr.insert(ignore_permissions=True)
		pr.submit()
		if state in ("billed", "paid", "part"):
			pi = make_purchase_invoice(pr.name)
			pi.bill_no = f"INV-{random.randint(1000, 9999)}"
			pi.bill_date = pr.posting_date
			pi.posting_date = pr.posting_date
			pi.set_posting_time = 1
			pi.due_date = _d(days + 30)
			pi.insert(ignore_permissions=True)
			pi.submit()
			if state in ("paid", "part"):
				pe = get_payment_entry("Purchase Invoice", pi.name)
				pe.posting_date = _d(days + 10)
				pe.reference_no = f"TRF-{random.randint(10000, 99999)}"
				pe.reference_date = pe.posting_date
				if state == "part":
					pe.paid_amount = pe.received_amount = round(pe.paid_amount * 0.6)
					pe.references[0].allocated_amount = pe.paid_amount
				pe.insert(ignore_permissions=True)
				pe.submit()
	# material released to work over the last two weeks
	who = ISSUED_TO[v]
	people = [who[0], who[1], who[2], who[0], who[1]]
	issues = [("CEM-OPC", 40, "Ground-floor columns"), ("STL-12", 900, "Roof slab steel"), ("BLK-6", 1500, "Boundary wall"), ("CEM-OPC", 55, "Roof slab"),
		("STL-16", 700, "Columns C1–C8"), ("SND-RAVI", 400, "Plaster mix"), ("CRS-34", 600, "Roof slab"), ("BND-WIRE", 30, "Roof slab steel"), ("CEM-OPC", 35, "Plinth beam")]
	issues = [(c, _qty(c, q, v), area) for c, q, area in issues]
	for n, (item, qty, area) in enumerate(issues):
		have = flt(frappe.db.get_value("Bin", {"item_code": item, "warehouse": wh}, "actual_qty"))
		if have < qty:
			continue
		se = frappe.get_doc({"doctype": "Stock Entry", "stock_entry_type": "Material Issue", "company": co, "posting_date": _d(-13 + n), "set_posting_time": 1, "project": project,
			"buildiary_issued_to": people[n % len(people)], "buildiary_work_area": area,
			"items": [{"item_code": item, "qty": qty, "s_warehouse": wh, "project": project}]})
		se.insert(ignore_permissions=True)
		se.submit()
	# re-order levels so the store shows what is running low
	for item, lvl in (("CEM-OPC", 400), ("BND-WIRE", 60), ("CND-1", 50), ("BLK-4", 1000)):
		it = frappe.get_doc("Item", item)
		it.append("reorder_levels", {"warehouse": wh, "warehouse_reorder_level": lvl, "warehouse_reorder_qty": lvl, "material_request_type": "Purchase"})
		it.save(ignore_permissions=True)


def _people(co, k):
	v = _V["v"]
	contractor = frappe.db.get_value("Supplier", {"supplier_name": _sup_name(6)})
	crew = WORKERS[v]
	phone = {"pk": "0301-77{n:05d}", "gulf": "055-77{n:05d}", "intl": "021-77{n:05d}"}[v]
	workers = []
	for n, (name, wtype, trade) in enumerate(crew):
		w = frappe.get_doc({"doctype": "Site Worker", "full_name": name, "worker_type": wtype, "trade": trade, "contractor": contractor if wtype != "Supervisor" else None,
			"status": "Active", "daily_wage": _r({"Mistri": 3000, "Group head": 3500, "Labour": 1800, "Supervisor": 4000}[wtype], k), "phone": phone.format(n=n),
			"joined_on": _d(-90 + n), "app_access": "Site supervisor" if wtype == "Supervisor" else "No sign-in"})
		w.flags.ignore_permissions = True
		w.insert()
		workers.append(w)
	att = frappe.get_doc({"doctype": "Site Attendance", "date": nowdate(), "project": _project(), "location": "Site gate", "remarks": "",
		"rows": [{"worker": w.name, "status": "Present" if i < 11 else ("Half day" if i == 11 else "Absent"), "time_in": "08:0%d:00" % (i % 10), "time_out": "17:30:00" if i in (4, 5) else None}
			for i, w in enumerate(workers[:13])]})
	att.insert(ignore_permissions=True)
	frappe.get_doc({"doctype": "Site Diary", "date": nowdate(), "project": _project(), "weather": "Sunny", "workers": 12,
		"work_done": "Ground-floor roof slab: steel fixing on grid A–C finished and checked. Shuttering for the staircase started.",
		"materials_used": "Cement 55 bags, crush 600 cft, binding wire 30 kg" if v == "pk" else "Cement 55 bags, aggregate 17 m³, binding wire 30 kg", "issues": "Ready-mix truck booked for Thursday morning.",
		"visitors": "Structural engineer checked the slab steel"}).insert(ignore_permissions=True)
	return workers


def _water_and_cash(co, k):
	sup = frappe.db.get_value("Site Worker", {"worker_type": "Supervisor"})
	tanks = frappe.get_all("Water Tank", filters={"is_active": 1, "capacity_gallons": [">", 0]}, fields=["name"], order_by="sort_order")
	for n, (days, gal, tds) in enumerate(((-6, 3000, 640), (-4, 3000, 700), (-2, 5000, 610), (-1, 1000, 1450), (0, 3000, 655))):
		t = frappe.get_doc({"doctype": "Water Tanker", "date": _d(days), "time": "09:30:00", "vehicle_no": f"{'TLD' if _V['v'] == 'pk' else 'WT'}-{4210 + n}", "supplier_text": "Sample Hydrant",
			"gallons": gal, "water_type": "Brackish (rejected)" if tds > 1000 else "Sweet (construction & curing)", "tds_ppm": tds, "cost": _r(gal * 1.2, k),
			"emptied_into": tanks[0].name if tanks and tds <= 1000 else None, "project": _project()})
		t.insert(ignore_permissions=True)
		if tds <= 1000:
			t.submit()
	for t, lvl in zip(tanks, (64, 80)):
		frappe.get_doc({"doctype": "Water Tank Reading", "date": nowdate(), "time": nowtime(), "tank": t.name, "level_pct": lvl, "project": _project()}).insert(ignore_permissions=True)
	if not sup:
		return
	from buildiary import petty

	given = frappe.get_doc({"doctype": "Petty Cash Entry", "entry_type": "Cash given", "date": _d(-10), "holder": sup, "amount": _r(50000, k), "method": "Cash in hand", "project": _project()})
	given.insert(ignore_permissions=True)
	given.submit()
	cats = {c.category_name: c for c in frappe.get_all("Petty Cash Category", fields=["name", "category_name", "expense_account"])}
	head = WORKERS[_V["v"]][3][0]
	near = ("Hotel near site", "Loader rickshaw") if _V["v"] == "pk" else ("Site canteen", "Pickup truck hire")
	for days, cat, amt, to, status in ((-8, "Canteen & food", 6500, near[0], "Approved"), (-6, "Transport & fuel", 4200, near[1], "Approved"),
		(-3, "Small tools & hardware", 7800, "Hardware store", "Approved"), (-1, "Labour advance", 10000, head, "Waiting for owner"), (0, "Canteen & food", 3100, "Tea stall", "Waiting for owner")):
		c = cats.get(cat)
		if not c:
			continue
		e = frappe.get_doc({"doctype": "Petty Cash Entry", "entry_type": "Expense", "date": _d(days), "holder": sup, "amount": _r(amt, k), "category": c.name,
			"expense_account": c.expense_account, "paid_to": to, "method": "Cash in hand", "status": "Waiting for owner", "project": _project()})
		e.insert(ignore_permissions=True)
		if status == "Approved":
			e.submit()


def _quality():
	project = _project()
	steel = frappe.db.get_value("Supplier", {"supplier_name": _sup_name(6)})
	ins = frappe.get_doc({"doctype": "Site Inspection", "date": _d(-2), "project": project, "inspection_type": "Steel before concrete", "location": "Ground-floor roof slab",
		"supplier": steel, "inspector": "Structural engineer", "result": "Pass with remarks",
		"checks": [{"check": "Bar sizes and spacing as per drawing", "result": "OK"}, {"check": "Cover blocks in place", "result": "OK"}, {"check": "Laps and anchorage", "result": "OK"}],
		"remarks": "Add cover blocks near the stair opening before the pour."})
	ins.insert(ignore_permissions=True)
	ins.submit()
	for desc, loc, status, days in (("Honeycombing on column C4 face", "Ground floor, grid C4", "Open", 3), ("Plinth beam level off by 10 mm at the gate side", "Plinth, east side", "In progress", -2),
		("Waterproofing membrane torn near the drain", "Basement wall", "Open", 5)):
		frappe.get_doc({"doctype": "Site Snag", "description": desc, "location": loc, "project": project, "status": status, "supplier": steel, "responsible_person": WORKERS[_V["v"]][3][0],
			"target_date": _d(days)}).insert(ignore_permissions=True)


def _debris(k):
	"""Where debris goes in skips (on by default in the Gulf): a skip on site and its collections."""
	if not frappe.db.get_single_value("Buildiary Settings", "debris_enabled") or len(NAMES[_V["v"]]["suppliers"]) < 9:
		return
	from frappe.utils import now_datetime

	sup = frappe.db.get_value("Supplier", {"supplier_name": _sup_name(8)})
	if not sup:
		return
	frappe.db.set_single_value("Buildiary Settings", "debris_supplier", sup)
	k1 = frappe.get_doc({"doctype": "Debris Container", "container_no": "SK-2231", "supplier": sup, "size_m3": 10, "placed_on": _d(-20), "location": "By the gate, street side",
		"status": "On site", "fill": "Nearly full", "fill_on": now_datetime(), "every_days": 3, "next_collection": _d(1), "permit_no": "RP-55120", "permit_expires": _d(40),
		"project": _project()}).insert(ignore_permissions=True)
	for days, slip, cost in ((-9, "DT-80412", 16000), (-6, "DT-80577", 16000), (-3, "DT-80733", 16000)):
		frappe.get_doc({"doctype": "Debris Removal", "date": _d(days), "kind": "Exchange (full for empty)", "status": "Done", "container": k1.name, "supplier": sup,
			"reason": "Scheduled", "requested_on": f"{_d(days)} 08:00:00", "requested_by": "Administrator", "notified": "Email", "done_on": f"{_d(days)} 11:30:00",
			"vehicle_no": f"SKP-{4400 + days * -1}", "loads": 1, "slip_no": slip, "cost": _r(cost, k), "received_by_name": WORKERS[_V["v"]][13][0], "project": _project()}).insert(ignore_permissions=True)


AR = {
	"project": "مسكن النور",
	"projects": {"Al Noor Residence": "مسكن النور", "Al Noor Villa": "فيلا النور", "Maple Grove House": "بيت مابل غروف"},
	"tasks": {"D1": "ملخص التصميم والمخططات الأولية", "D2": "المخططات الإنشائية والكهروميكانيكية", "A1": "اعتماد رخصة البناء", "G1": "التجهيز والحفر",
		"G2": "الأساسات والعزل والميدة", "G3": "أعمدة وسقف الدور الأرضي", "G4": "أعمدة وسقف الدور الأول", "G5": "البلوك والدروة وخزانات الماء",
		"G6": "اللياسة وتسليم العظم", "F1": "التأسيس الكهروميكانيكي وحلوق النوافذ", "F2": "الأرضيات وبلاط الجدران", "F3": "النجارة والمطبخ والألمنيوم",
		"F4": "الدهان والأدوات الصحية والإنارة", "H1": "قائمة الملاحظات والتسليم"},
	"items": {"CEM-OPC": "إسمنت بورتلاندي (كيس 50 كجم)", "STL-12": "حديد تسليح 12 مم", "STL-16": "حديد تسليح 16 مم", "STL-10": "حديد تسليح 10 مم", "BLK-6": "بلوك خرساني 20 سم",
		"BLK-4": "بلوك خرساني 15 سم", "SND-RAVI": "رمل", "CRS-34": "بحص 3/4", "BND-WIRE": "سلك رباط", "SHT-PLY": "خشب شدّة 18 مم", "WPF-CHEM": "مادة عزل مائي",
		"CND-1": "ماسورة كهرباء 1 بوصة", "PIPE-4": "ماسورة صرف 4 بوصة", "PPR-25": "ماسورة PPR ‏25 مم", "TIL-6060": "بلاط بورسلان 60×60", "MRB-WHT": "رخام أبيض",
		"PNT-EMU": "دهان بلاستيك أبيض", "PUTTY": "معجون جدران", "GLV": "قفازات عمل", "HLMT": "خوذة سلامة"},
	"suppliers": {"Madina Cement Traders": "مؤسسة المدينة للإسمنت", "Faisal Steel Store": "معرض فيصل للحديد", "Al Noor Block Factory": "مصنع النور للبلوك",
		"Riverside Sand & Crush": "مؤسسة الوادي للرمل والبحص", "Ravi Electric Co.": "شركة الراوي للكهرباء", "City Pipes & Fittings": "المدينة للمواسير والتمديدات",
		"Star Builders": "مؤسسة النجم للمقاولات", "Gulberg Tiles & Marble": "معرض الخليج للبلاط والرخام",
		"Al Waha Cement Trading": "مؤسسة الواحة لتجارة الإسمنت", "Gulf Rebar Trading": "الخليج لتجارة حديد التسليح", "Desert Block Factory": "مصنع الصحراء للبلوك",
		"Al Rimal Sand & Aggregates": "الرمال للرمل والبحص", "Noor Electrical Trading": "النور للتجارة الكهربائية", "Al Madina Pipes & Fittings": "المدينة للمواسير والتمديدات",
		"Al Bina Contracting": "البناء للمقاولات", "Marmar Tiles & Marble": "مرمر للبلاط والرخام", "Green Skip Services": "الخضراء لخدمات الحاويات"},
	"workers": {"Rafiq Ahmed": "رفيق أحمد", "Shahid Mehmood": "شاهد محمود", "Imran Ali": "عمران علي", "Nasir Hussain": "ناصر حسين", "Arif Khan": "عارف خان", "Zahid Iqbal": "زاهد إقبال",
		"Sajid Ali": "ساجد علي", "Waqas Ahmed": "وقاص أحمد", "Fahad Hussain": "فهد حسين", "Bilal Akram": "بلال أكرم", "Tariq Mehmood": "طارق محمود", "Junaid Khan": "جنيد خان",
		"Kashif Ali": "كاشف علي", "Asad Raza": "أسعد رضا", "Ramesh Kumar": "راميش كومار", "Biju Thomas": "بيجو توماس", "Abdul Karim": "عبد الكريم",
		"Mohammed Rafi": "محمد رفيع", "Suresh Babu": "سوريش بابو", "Mahmoud Saleh": "محمود صالح"},
}


def localize_ar():
	"""Arabic names for the sample project (for the Arabic screenshots)."""
	p = _project() or frappe.db.get_value("Project", {"project_name": ["in", list(AR["projects"])]})
	if not p:
		return
	frappe.db.set_value("Project", p, "project_name", AR["projects"].get(frappe.db.get_value("Project", p, "project_name"), AR["project"]), update_modified=False)
	for t in frappe.get_all("Task", filters={"project": p}, fields=["name", "subject"]):
		code = t.subject.split(" ")[0]
		if code in AR["tasks"]:
			frappe.db.set_value("Task", t.name, "subject", f"{code} {AR['tasks'][code]}", update_modified=False)
	for code, name in AR["items"].items():
		if frappe.db.exists("Item", code):
			frappe.db.set_value("Item", code, {"item_name": name, "description": name}, update_modified=False)
			frappe.db.sql("update `tabStock Entry Detail` set item_name=%s where item_code=%s", (name, code))
			frappe.db.sql("update `tabPurchase Order Item` set item_name=%s where item_code=%s", (name, code))
	for old, new in AR["suppliers"].items():
		s = frappe.db.get_value("Supplier", {"supplier_name": old})
		if s:
			frappe.db.set_value("Supplier", s, "supplier_name", new, update_modified=False)
			for dt in ("Purchase Order", "Purchase Receipt", "Purchase Invoice", "Supplier Quotation"):
				frappe.db.sql(f"update `tab{dt}` set supplier_name=%s where supplier=%s", (new, s))
	for old, new in AR["workers"].items():
		w = frappe.db.get_value("Site Worker", {"full_name": old})
		if w:
			frappe.db.set_value("Site Worker", w, "full_name", new, update_modified=False)
			frappe.db.sql("update `tabSite Attendance Row` set worker_name=%s where worker=%s", (new, w))
			frappe.db.sql("update `tabPetty Cash Entry` set holder_name=%s where holder=%s", (new, w))
	for old, new in (("Ustad Rafiq (mason)", "الأسطى رفيق (بنّاء)"), ("Shahid (steel fixer)", "شاهد (حدّاد)"), ("Imran (shuttering)", "عمران (نجّار شدّة)"),
			("Rafiq (mason)", "رفيق (بنّاء)"), ("Ramesh (shuttering)", "راميش (نجّار شدّة)")):
		frappe.db.sql("update `tabStock Entry` set buildiary_issued_to=%s where buildiary_issued_to=%s", (new, old))
	frappe.db.commit()
	frappe.clear_cache()
	print("ARABIC NAMES SET")
