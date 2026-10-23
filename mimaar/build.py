"""Build progress: the master schedule's stages, grouped by phase.

Each stage (an ERPNext Task) has three figures:
- planned: where the work should be today (a straight line from the planned start to the finish);
- reported: the latest progress reported from site (supervisor, builder);
- verified: the owner's side has checked it (the figure used once it is there).
"Built" is the verified figure when there is one, otherwise the reported one; it is also kept as
the Task's progress, so ERPNext's project % complete follows it. Every report, check or photo is a
Stage Update with up to three photos, so photos of a stage can be compared over time.
"""

import frappe
from frappe import _
from frappe.utils import cint, date_diff, flt, getdate, now_datetime, nowdate, nowtime

from mimaar.field import _need, _parse, _photo_ok, _project, _roles, caps

PHASES = ["Design", "Approvals", "Grey structure", "Finishing", "Handover"]


def can_verify():
	r = _roles()
	return "System Manager" in r or "Projects Manager" in r


def _planned(t, today):
	if not t.exp_start_date or not t.exp_end_date:
		return 0.0
	s, e = getdate(t.exp_start_date), getdate(t.exp_end_date)
	if today >= e:
		return 100.0
	if today <= s:
		return 0.0
	return round(100.0 * date_diff(today, s) / max(1, date_diff(e, s)), 1)


def _built(t):
	return flt(t.mimaar_verified) if t.mimaar_verified_on else (flt(t.mimaar_reported) or flt(t.progress))


def _photos(names, per=4):
	"""Latest photos of each stage (newest first)."""
	out = {n: [] for n in names}
	if not names:
		return out
	for u in frappe.get_all("Stage Update", filters={"task": ["in", names]}, fields=["task", "date", "kind", "photo_1", "photo_2", "photo_3"],
		order_by="date desc, creation desc", limit_page_length=500):
		for p in (u.photo_1, u.photo_2, u.photo_3):
			if p and len(out[u.task]) < per:
				out[u.task].append({"url": p, "date": u.date, "kind": u.kind})
	return out


def _state(st, today):
	if st["built"] >= 100:
		return "done"
	started = st["start"] and getdate(st["start"]) <= today
	if started and st["planned"] - st["built"] >= 10:
		return "behind"
	if st["built"] > 0 or started:
		return "now"
	if st["start"] and date_diff(getdate(st["start"]), today) <= 30:
		return "soon"
	return "later"


def _stage_rows(project=None):
	project = project or _project()
	today = getdate(nowdate())
	rows = frappe.get_all("Task", filters={"project": project, "status": ["!=", "Cancelled"]} if project else {"status": ["!=", "Cancelled"]},
		fields=["name", "subject", "status", "progress", "exp_start_date", "exp_end_date", "task_weight", "mimaar_phase", "mimaar_reported", "mimaar_verified",
			"mimaar_verified_on", "mimaar_verified_by", "is_group", "description"],
		order_by="exp_start_date asc, creation asc", limit_page_length=1000)
	out = []
	for t in rows:
		if t.is_group:
			continue
		code, title = "", t.subject or ""
		parts = title.split(" ", 1)
		if len(parts) == 2 and len(parts[0]) <= 4 and parts[0][:1].isalpha() and parts[0][1:].isdigit():
			code, title = parts
		ur = ""
		d = frappe.utils.strip_html(t.description or "")
		if " · " in d:
			ur = d.split(" · ", 1)[1].strip()
		st = {"name": t.name, "code": code, "title": title, "title_ur": ur if any("\u0600" <= ch <= "\u06ff" for ch in ur) else "", "phase": t.mimaar_phase or "Other", "start": t.exp_start_date, "end": t.exp_end_date,
			"weight": flt(t.task_weight) or 1, "reported": flt(t.mimaar_reported) or flt(t.progress), "verified": flt(t.mimaar_verified) if t.mimaar_verified_on else None,
			"verified_on": t.mimaar_verified_on, "built": _built(t), "planned": _planned(t, today), "status": t.status,
			"days_left": date_diff(getdate(t.exp_end_date), today) if t.exp_end_date else None}
		st["state"] = _state(st, today)
		out.append(st)
	return out


def _weighted(rows, key):
	w = sum(r["weight"] for r in rows)
	return round(sum(r["weight"] * min(100, r[key]) for r in rows) / w, 1) if w else 0.0


@frappe.whitelist()
def stages():
	"""Every stage with its figures and latest photos, by phase, plus the whole project's figures."""
	c = caps()
	if not (c["site"] or c["owner"] or c["people"] or c["store"]):
		frappe.throw(_("You don't have access to this. Ask the owner."), frappe.PermissionError)
	rows = _stage_rows()
	ph = _photos([r["name"] for r in rows])
	counts = {}
	for r in rows:
		r["photos"] = ph.get(r["name"], [])
		counts[r["state"]] = counts.get(r["state"], 0) + 1
	phases = []
	for name in PHASES + sorted({r["phase"] for r in rows} - set(PHASES)):
		ps = [r for r in rows if r["phase"] == name]
		if ps:
			phases.append({"name": name, "start": min((r["start"] for r in ps if r["start"]), default=None), "end": max((r["end"] for r in ps if r["end"]), default=None),
				"built": _weighted(ps, "built"), "planned": _weighted(ps, "planned"), "stages": ps})
	now = next((r for r in rows if r["state"] in ("now", "behind")), None) or next((r for r in rows if r["state"] in ("soon", "later")), None)
	nxt = None
	if now:
		later = [r for r in rows if r["start"] and now["start"] and getdate(r["start"]) > getdate(now["start"]) and r["state"] != "done"]
		nxt = later[0] if later else None
	return {"phases": phases, "built": _weighted(rows, "built"), "planned": _weighted(rows, "planned"), "counts": counts,
		"now": now and {k: now[k] for k in ("name", "code", "title", "title_ur", "end", "built", "planned")}, "next": nxt and {k: nxt[k] for k in ("name", "code", "title", "title_ur", "start")},
		"can_verify": can_verify(), "can_report": bool(c["site"])}


@frappe.whitelist()
def stage(name):
	"""One stage: its figures and every update with photos (newest first)."""
	t = frappe.get_doc("Task", name)
	t.check_permission("read")
	row = next((r for r in _stage_rows(t.project) if r["name"] == name), None)
	ups = frappe.get_all("Stage Update", filters={"task": name}, fields=["name", "kind", "pct", "note", "date", "time", "recorded_by", "photo_1", "photo_2", "photo_3"],
		order_by="date desc, creation desc", limit_page_length=200)
	names = {}
	for u in ups:
		u.time = str(u.time or "")[:5]
		if u.recorded_by not in names:
			names[u.recorded_by] = frappe.utils.get_fullname(u.recorded_by)
		u.by = names[u.recorded_by]
	return {"stage": row, "updates": ups, "can_verify": can_verify(), "can_report": bool(caps()["site"])}


def _set(t, reported=None, verified=None):
	if reported is not None:
		t.mimaar_reported = reported
	if verified is not None:
		t.mimaar_verified = verified
		t.mimaar_verified_by = frappe.session.user
		t.mimaar_verified_on = nowdate()
	built = flt(t.mimaar_verified) if t.mimaar_verified_on else flt(t.mimaar_reported)
	t.progress = built
	if built >= 100:
		t.status = "Completed"
		t.completed_on = t.completed_on or nowdate()
		t.completed_by = t.completed_by or frappe.session.user
	elif built > 0 and t.status in ("Open", "Overdue", "Pending Review", "Completed"):
		t.status = "Working"
	t.flags.ignore_permissions = True
	t.save()


def _update(task, kind, pct=None, note=None, photos=None, location=None):
	ph = [p for p in (_parse(photos) or []) if _photo_ok(p)][:3]
	u = frappe.get_doc({"doctype": "Stage Update", "task": task, "kind": kind, "pct": flt(pct) if pct is not None else None, "note": note, "date": nowdate(), "time": nowtime(),
		"location": location, "project": frappe.db.get_value("Task", task, "project"), **{f"photo_{i + 1}": p for i, p in enumerate(ph)}})
	u.flags.ignore_permissions = True
	u.insert()
	for p in ph:
		f = frappe.db.get_value("File", {"file_url": p}, ["name", "attached_to_name"], as_dict=True)
		if f and not f.attached_to_name:
			frappe.db.set_value("File", f.name, {"attached_to_doctype": "Task", "attached_to_name": task})
	return u


@frappe.whitelist()
def report(task, pct, note=None, photos=None, location=None):
	"""Progress reported from site: % done now, what was done, up to three photos."""
	_need("site")
	t = frappe.get_doc("Task", task)
	t.check_permission("read")
	p = max(0, min(100, flt(pct)))
	if not (_parse(photos) or []) and p > flt(t.mimaar_reported):
		frappe.throw(_("Take at least one photo of the work."), title=_("Photo needed"))
	u = _update(task, "Reported", p, note, photos, location)
	_set(t, reported=p)
	return {"name": u.name, "built": t.progress}


@frappe.whitelist()
def verify(task, pct, note=None, photos=None, location=None):
	"""The owner's side checks the work on site and sets the verified %."""
	if not can_verify():
		frappe.throw(_("Only the owner (or the project manager) verifies progress."), frappe.PermissionError)
	t = frappe.get_doc("Task", task)
	p = max(0, min(100, flt(pct)))
	u = _update(task, "Verified", p, note, photos, location)
	_set(t, verified=p)
	return {"name": u.name, "built": t.progress}


@frappe.whitelist()
def add_photo(task, photos, note=None, location=None):
	"""A progress photo without changing the figures."""
	_need("site")
	frappe.get_doc("Task", task).check_permission("read")
	if not [p for p in (_parse(photos) or []) if _photo_ok(p)]:
		frappe.throw(_("Take the photo first."))
	return _update(task, "Photo", None, note, photos, location).name


@frappe.whitelist()
def compare(task, before, after):
	"""What changed between two photos of a stage (AI), with its estimate of the stage's progress."""
	from mimaar import ai

	t = frappe.get_doc("Task", task)
	t.check_permission("read")
	dates = {}
	for p in (before, after):
		r = frappe.db.sql("""select date from `tabStage Update` where task = %(t)s and (photo_1 = %(p)s or photo_2 = %(p)s or photo_3 = %(p)s) limit 1""", {"t": task, "p": p})
		if not r:
			frappe.throw(_("Choose two photos of this stage."))
		dates[p] = r[0][0]
	prompt = (f"Two photos of the same stage of a house under construction in Pakistan: \"{t.subject}\". "
		f"Photo 1 was taken on {dates[before]}, photo 2 on {dates[after]}. Describe in two or three short sentences what work was done between them, "
		"and estimate how complete this stage looks in photo 2. Point out anything that looks wrong or unsafe. "
		'Reply with only JSON: {"summary": string, "progress_estimate_pct": number, "concerns": [string]}')
	r = ai.ask_many(prompt, [before, after]) if frappe.conf.get("mimaar_fake_ai_file") else ai._call(prompt, [ai._file(before), ai._file(after)], max_tokens=1024)
	return {"summary": r.get("summary") or "", "estimate": r.get("progress_estimate_pct"), "concerns": r.get("concerns") or []}
