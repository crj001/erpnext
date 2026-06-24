frappe.listview_settings["Item"] = {
	add_fields: [
		"item_name",
		"stock_uom",
		"item_group",
		"image",
		"has_variants",
		"end_of_life",
		"disabled",
		"variant_of",
	],
	filters: [["disabled", "=", "0"]],

	get_indicator: function (doc) {
		if (doc.disabled) {
			return [__("Disabled"), "grey", "disabled,=,Yes"];
		} else if (doc.end_of_life && doc.end_of_life < frappe.datetime.get_today()) {
			return [__("Expired"), "grey", "end_of_life,<,Today"];
		} else if (doc.has_variants) {
			return [__("Template"), "orange", "has_variants,=,Yes"];
		} else if (doc.variant_of) {
			return [__("Variant"), "green", "variant_of,=," + doc.variant_of];
		}
	},

	reports: [
		{
			name: "Stock Summary",
			route: "/app/stock-balance",
		},
		{
			name: "Stock Ledger",
			report_type: "Script Report",
		},
		{
			name: "Stock Balance",
			report_type: "Script Report",
		},
		{
			name: "Stock Projected Qty",
			report_type: "Script Report",
		},
	],

	onload: function (listview) {
		listview.page.add_menu_item("导入物料图片", function () {
			show_import_images_dialog(listview);
		});
	},
};

frappe.help.youtube_id["Item"] = "qXaEwld4_Ps";

function show_import_images_dialog(listview) {
	let dialog = new frappe.ui.Dialog({
		title: "导入物料图片",
		fields: [
			{
				label: "说明",
				fieldname: "instructions",
				fieldtype: "HTML",
				options: `
					<div class="alert alert-info">
						<p><strong>说明：</strong></p>
						<ol style="margin: 0; padding-left: 20px;">
							<li>准备包含物料图片的ZIP压缩包</li>
							<li>图片文件名需与物料编码一致（如 ITEM001.jpg）</li>
							<li>支持格式：jpg, jpeg, png, gif, webp</li>
							<li>单张图片最大 5MB</li>
						</ol>
					</div>
				`,
			},
			{
				label: "更新策略",
				fieldname: "update_strategy",
				fieldtype: "Select",
				options: [
					{ label: "覆盖现有图片", value: "overwrite" },
					{ label: "跳过已有图片的物料", value: "skip" },
				],
				default: "overwrite",
			},
			{
				label: "上传ZIP文件",
				fieldname: "zip_file",
				fieldtype: "Attach",
				options: {
					restrictions: {
						allowed_file_types: [".zip"],
					},
				},
			},
		],
		primary_action_label: "导入",
		primary_action: function (values) {
			if (!values.zip_file) {
				frappe.msgprint("请上传ZIP文件");
				return;
			}

			dialog.hide();
			import_item_images(values.zip_file, values.update_strategy, listview);
		},
	});

	dialog.show();
}

function import_item_images(file_url, update_strategy, listview) {
	frappe.call({
		method: "erpnext.stock.doctype.item.item_image_import.import_item_images_from_url",
		args: {
			file_url: file_url,
			update_strategy: update_strategy,
		},
		freeze: true,
		freeze_message: "正在导入物料图片...",
		callback: function (r) {
			if (r.message) {
				show_import_result(r.message, listview);
			}
		},
		error: function (err) {
			frappe.msgprint("导入图片失败");
		},
	});
}

function show_import_result(result, listview) {
	let message = `
		<div class="import-result">
			<p><strong>导入统计：</strong></p>
			<ul>
				<li>文件总数：${result.total_files}</li>
				<li>成功导入：<span class="text-success">${result.success_count}</span></li>
				<li>跳过数量：${result.skipped_count}</li>
				<li>失败数量：<span class="text-danger">${result.failed_count}</span></li>
			</ul>
	`;

	if (result.errors && result.errors.length > 0) {
		message += `
			<p><strong>错误详情：</strong></p>
			<div style="max-height: 200px; overflow-y: auto;">
				<table class="table table-bordered table-condensed">
					<thead>
						<tr>
							<th>文件</th>
							<th>原因</th>
						</tr>
					</thead>
					<tbody>
		`;
		result.errors.forEach(function (error) {
			message += `
				<tr>
					<td>${error.file}</td>
					<td>${error.reason}</td>
				</tr>
			`;
		});
		message += `
					</tbody>
				</table>
			</div>
		`;
	}

	message += `</div>`;

	frappe.msgprint({
		title: "导入结果",
		message: message,
		indicator: result.failed_count > 0 ? "orange" : "green",
	});

	// 刷新列表
	if (listview) {
		listview.refresh();
	}
}
