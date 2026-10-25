// Daily labour attendance: scan each worker's site card (their registered face photo is
// shown to compare with the person), take the team photo; the phone's location is added.
frappe.ui.form.on("Site Attendance", {
	onload(frm) {
		if (frm.is_new() && !frm.doc.location) buildiary.locate(frm, true);
	},
	refresh(frm) {
		if (frm.doc.docstatus !== 0) return;
		frm.add_custom_button(__("Scan site cards"), () => buildiary.scan_cards(frm)).addClass("btn-primary");
		frm.add_custom_button(__("Update location"), () => buildiary.locate(frm));
		frm.dashboard.set_headline(__("Scan each worker's site card, take the team photo, then Submit."), "blue");
	},
	rows_remove: (frm) => buildiary.recount(frm),
});
frappe.ui.form.on("Site Attendance Row", { status: (frm) => buildiary.recount(frm) });

buildiary.recount = function (frm) {
	const rows = frm.doc.rows || [];
	frm.set_value("present", rows.filter((r) => r.status === "Present").length);
	frm.set_value("half_day", rows.filter((r) => r.status === "Half day").length);
};

buildiary.locate = function (frm, quiet) {
	if (!navigator.geolocation) {
		if (!quiet) frappe.msgprint(__("This phone or browser can't give the location."));
		return;
	}
	navigator.geolocation.getCurrentPosition(
		(p) => {
			const c = p.coords;
			frm.set_value("location", `${c.latitude.toFixed(6)}, ${c.longitude.toFixed(6)} (±${Math.round(c.accuracy)} m)`);
			if (!quiet) frappe.show_alert({ message: __("Location updated"), indicator: "green" });
		},
		() => { if (!quiet) frappe.msgprint(__("Location not available: allow location for this site, then press Update location again.")); },
		{ enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
	);
};

buildiary.scan_cards = function (frm) {
	new frappe.ui.Scanner({
		dialog: true,
		multiple: true,
		on_scan(data) {
			const code = (data && data.result && data.result.text) || (data && data.decodedText) || "";
			if (code) buildiary.add_worker(frm, code);
		},
	});
};

buildiary.add_worker = function (frm, code) {
	return frappe.call({ method: "buildiary.api.find_worker", args: { code } }).then((r) => {
		const w = r.message;
		const face = (w && w.photo) ? `<img src="${encodeURI(w.photo)}" style="height:72px;width:72px;object-fit:cover;border-radius:8px;margin-top:6px">` : "";
		if (!w) return frappe.show_alert({ message: __("Card not recognised: {0}", [frappe.utils.escape_html(code)]), indicator: "red" }, 6);
		const nm = frappe.utils.escape_html(w.full_name);
		if (w.status !== "Active") return frappe.show_alert({ message: __("{0} is {1} in the worker register: not allowed on site.", [nm, __(w.status)]), body: face, indicator: "red" }, 8);
		if ((frm.doc.rows || []).some((x) => x.worker === w.name)) return frappe.show_alert({ message: __("{0} is already marked.", [nm]), body: face, indicator: "orange" }, 4);
		frm.add_child("rows", { worker: w.name, worker_name: w.full_name, trade: w.trade, contractor: w.contractor, daily_wage: w.daily_wage, status: "Present", time_in: frappe.datetime.now_time(), scanned: 1 });
		frm.refresh_field("rows");
		buildiary.recount(frm);
		frappe.show_alert({ message: __("{0}: present. Check the face matches.", [nm]), body: face, indicator: "green" }, 6);
	});
};
