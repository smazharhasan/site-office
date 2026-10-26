app_name = "buildiary"
app_title = "Buildiary"
app_publisher = "SMH Global Services (Pvt) Ltd"
app_description = "Construction procurement, stores, supplier accounts and site management on ERPNext"
app_email = "info@smhglobal.com.pk"
app_license = "mit"
required_apps = ["frappe/erpnext"]
app_logo_url = "/assets/buildiary/images/buildiary-logo.svg"
app_home = "/desk/buildiary"

add_to_apps_screen = [
	{
		"name": app_name,
		"logo": "/assets/buildiary/images/buildiary-logo.svg",
		"title": app_title,
		"route": app_home,
	}
]

app_include_js = ["/assets/buildiary/js/buildiary.js"]
app_include_css = ["/assets/buildiary/css/buildiary.css"]

doctype_js = {
	"Supplier": "public/js/supplier.js",
	"Supplier Quotation": "public/js/supplier_quotation.js",
	"Request for Quotation": "public/js/request_for_quotation.js",
	"Purchase Order": "public/js/purchase_order.js",
	"Purchase Receipt": "public/js/purchase_receipt.js",
	"Purchase Invoice": "public/js/purchase_invoice.js",
	"Payment Entry": "public/js/payment_entry.js",
	"Stock Entry": "public/js/stock_entry.js",
}
doctype_list_js = {
	"Supplier Quotation": "public/js/supplier_quotation_list.js",
	"Supplier": "public/js/supplier_list.js",
}

website_context = {
	"favicon": "/assets/buildiary/images/buildiary-logo.svg",
	"splash_image": "/assets/buildiary/images/buildiary-logo.svg",
}

jinja = {"methods": ["buildiary.api.qr_code", "buildiary.identity.card_code"]}

before_install = "buildiary.setup.before_install"
before_migrate = "buildiary.setup.before_install"

override_whitelisted_methods = {
	"erpnext.controllers.accounts_controller.update_child_qty_rate": "buildiary.procurement.update_items",
}

doc_events = {
	"Site Worker": {"on_update": "buildiary.identity.on_worker_update"},
	# each new document belongs to the person's current project (buildiary.projects)
	**{dt: {"before_insert": "buildiary.projects.tag"} for dt in ("Site Diary", "Site Inspection", "Site Snag", "Site Attendance", "Petty Cash Entry",
		"Water Tank", "Water Tank Reading", "Water Tanker")},
	"Supplier Quotation": {
		"before_insert": "buildiary.projects.tag",
		"validate": "buildiary.procurement.sq_validate",
		"before_cancel": "buildiary.procurement.sq_before_cancel",
	},
	"Purchase Order": {
		"before_insert": "buildiary.projects.tag",
		"validate": "buildiary.procurement.po_validate",
		"before_cancel": "buildiary.procurement.po_before_cancel",
	},
	"Purchase Receipt": {"before_insert": "buildiary.projects.tag", "before_submit": "buildiary.procurement.pr_before_submit"},
	"Purchase Invoice": {"before_insert": "buildiary.projects.tag", "before_submit": "buildiary.procurement.pi_before_submit"},
	"Payment Entry": {
		"before_insert": "buildiary.projects.tag",
		"validate": "buildiary.procurement.pe_validate",
		"before_submit": "buildiary.procurement.pe_before_submit",
	},
	"Communication": {"before_insert": "buildiary.procurement.comm_before_insert"},
	"Stock Entry": {"before_insert": "buildiary.projects.tag", "before_submit": "buildiary.procurement.se_before_submit"},
	# Buildiary Cloud: a plan's limits on people and projects
	"User": {"before_insert": "buildiary.saas.tenant.check_users"},
	"Project": {"before_insert": "buildiary.saas.tenant.check_projects"},
}

# Buildiary Cloud: the console keeps the pool of ready workspaces, checks plans every day
scheduler_events = {
	"daily": ["buildiary.saas.billing.daily", "buildiary.debris.daily"],
	"cron": {"*/10 * * * *": ["buildiary.saas.provision.tick"]},
}
get_website_user_home_page = "buildiary.saas.tenant.home_page"

# Urdu is written right to left (Frappe's list of RTL languages doesn't include it)
before_request = ["buildiary.rtl.apply", "buildiary.saas.tenant.enforce"]
boot_session = "buildiary.rtl.boot"

after_install = "buildiary.setup.after_install"
after_migrate = "buildiary.setup.after_migrate"
setup_wizard_complete = "buildiary.setup.after_setup"
