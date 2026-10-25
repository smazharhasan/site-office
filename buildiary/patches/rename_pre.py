"""One time only, before the first `bench migrate` after the product took the single name Buildiary.

The database of a site made before then still records the app, its two modules and a few settings
under the product's earlier names, so Frappe could not load the app. This step renames those
records with plain SQL (nothing of the app is imported) and renames the matching keys in
site_config.json. The rest (document types, roles, fields) is renamed by the patch
buildiary.patches.rename_records during the migrate that follows.

Run from the bench folder, for every site, before migrating:

    env/bin/python apps/buildiary/buildiary/patches/rename_pre.py <site> [<site> ...]

It is safe to run again. Delete this file and rename_records.py once every server has moved.
"""

import json
import os
import sys

import frappe

OLD_APP = "mimaar"
APP = "buildiary"
MODULES = {"Mimaar": "Buildiary", "Mabni Cloud": "Buildiary Cloud"}
OLD_KEYS = ("mimaar", "mabni")  # site_config.json keys: mabni, mabni_key, mabni_ai, mimaar_fake_ai_file, ...
USER_DEFAULTS = {"mabni_project": "buildiary_project", "mimaar_ui": "buildiary_ui"}


def new_key(k):
	for old in OLD_KEYS:
		if k == old or k.startswith(old + "_"):
			return APP + k[len(old):]
	return k


def config(path):
	if not os.path.exists(path):
		return
	conf = json.load(open(path, encoding="utf-8"))
	moved = {k: new_key(k) for k in conf if new_key(k) != k}
	for old, new in moved.items():
		conf[new] = conf.pop(old)
	if OLD_APP in (conf.get("installed_apps") or []):
		conf["installed_apps"] = [APP if a == OLD_APP else a for a in conf["installed_apps"]]
		moved["installed_apps: " + OLD_APP] = APP
	if moved:
		with open(path, "w", encoding="utf-8") as f:
			json.dump(conf, f, indent=1, sort_keys=True)
		print("  config:", ", ".join(f"{a} -> {b}" for a, b in moved.items()))


def site(name):
	print(name)
	frappe.init(site=name, sites_path=".")
	frappe.connect()
	db = frappe.db
	q = db.sql
	# the app
	q("update `tabInstalled Application` set app_name=%s where app_name=%s", (APP, OLD_APP))
	for row_name, value in q("select name, defvalue from tabDefaultValue where defkey='installed_apps'"):
		apps = [APP if a == OLD_APP else a for a in json.loads(value or "[]")]
		q("update tabDefaultValue set defvalue=%s where name=%s", (json.dumps(apps), row_name))
	# columns that hold a module or an app name, in every table of this site
	cols = q("""select table_name, column_name from information_schema.columns
		where table_schema=database() and column_name in ('module', 'module_name', 'app', 'app_name')""")
	for old, new in MODULES.items():
		if q("select count(*) from `tabModule Def` where name=%s", old)[0][0] and not q("select count(*) from `tabModule Def` where name=%s", new)[0][0]:
			q("update `tabModule Def` set name=%s, module_name=%s, app_name=%s where name=%s", (new, new, APP, old))
		for table, col in cols:
			if col in ("module", "module_name"):
				q(f"update `{table}` set `{col}`=%s where `{col}`=%s", (new, old))
	for table, col in cols:
		if col in ("app", "app_name"):
			q(f"update `{table}` set `{col}`=%s where `{col}`=%s", (APP, OLD_APP))
	# scheduled jobs are written again from the app's hooks on migrate; patches keep their record
	q("delete from `tabScheduled Job Type` where method like %s", (OLD_APP + ".%",))
	q("update `tabPatch Log` set patch=concat(%s, substring(patch, %s)) where patch like %s", (APP + ".", len(OLD_APP) + 2, OLD_APP + ".%"))
	for old, new in USER_DEFAULTS.items():
		q("update tabDefaultValue set defkey=%s where defkey=%s", (new, old))
	db.commit()
	frappe.destroy()
	config(os.path.join(name, "site_config.json"))


if __name__ == "__main__":
	if len(sys.argv) < 2:
		sys.exit(__doc__)
	config("common_site_config.json")
	for s in sys.argv[1:]:
		site(s)
