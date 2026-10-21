use tauri::menu::{AboutMetadata, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, Runtime};

pub const MENU_EVENT_NAME: &str = "mixboard-native-menu";

fn item<R: Runtime, M: Manager<R>>(
    manager: &M,
    id: &str,
    label: &str,
    accelerator: Option<&str>,
) -> tauri::Result<tauri::menu::MenuItem<R>> {
    let mut builder = MenuItemBuilder::with_id(id, label);
    if let Some(accelerator) = accelerator {
        builder = builder.accelerator(accelerator);
    }
    builder.build(manager)
}

pub fn install<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let about = PredefinedMenuItem::about(
        app,
        Some("关于 MixBoard"),
        Some(AboutMetadata {
            name: Some("MixBoard".into()),
            version: Some("0.1.0".into()),
            website: Some("https://github.com".into()),
            ..Default::default()
        }),
    )?;
    let services = PredefinedMenuItem::services(app, Some("服务"))?;
    let hide = PredefinedMenuItem::hide(app, Some("隐藏 MixBoard"))?;
    let hide_others = PredefinedMenuItem::hide_others(app, Some("隐藏其他"))?;
    let show_all = PredefinedMenuItem::show_all(app, Some("显示全部"))?;
    // Not PredefinedMenuItem::quit: that calls -[NSApp terminate:], which exits
    // without an ExitRequested event, so autosave never gets to flush.
    let quit = item(app, "app.quit", "退出 MixBoard", Some("CmdOrCtrl+Q"))?;
    let app_menu = SubmenuBuilder::new(app, "MixBoard")
        .item(&about)
        .item(&services)
        .separator()
        .item(&hide)
        .item(&hide_others)
        .item(&show_all)
        .separator()
        .item(&quit)
        .build()?;

    let file_new = item(app, "file.new", "新建画板", Some("CmdOrCtrl+N"))?;
    let file_open = item(app, "file.open", "打开文件", Some("CmdOrCtrl+O"))?;
    let file_save = item(app, "file.save", "保存", Some("CmdOrCtrl+S"))?;
    let file_export = item(app, "file.export_png", "导出 PNG…", Some("CmdOrCtrl+Shift+E"))?;
    let file_export_md = item(app, "file.export_md", "导出 Markdown…", Some("CmdOrCtrl+Shift+M"))?;
    let file_menu = SubmenuBuilder::new(app, "文件")
        .item(&file_new)
        .item(&file_open)
        .separator()
        .item(&file_save)
        .item(&file_export)
        .item(&file_export_md)
        .build()?;

    let edit_undo = item(app, "edit.undo", "撤销", Some("CmdOrCtrl+Z"))?;
    let edit_redo = item(app, "edit.redo", "重做", Some("CmdOrCtrl+Shift+Z"))?;
    let edit_duplicate = item(app, "edit.duplicate", "复制副本", Some("CmdOrCtrl+D"))?;
    let edit_delete = item(app, "edit.delete", "删除所选", Some("Delete"))?;
    let copy = PredefinedMenuItem::copy(app, Some("复制"))?;
    let paste = PredefinedMenuItem::paste(app, Some("粘贴"))?;
    let select_all = PredefinedMenuItem::select_all(app, Some("全选"))?;
    let edit_menu = SubmenuBuilder::new(app, "编辑")
        .item(&edit_undo)
        .item(&edit_redo)
        .separator()
        .item(&copy)
        .item(&paste)
        .item(&select_all)
        .separator()
        .item(&edit_duplicate)
        .item(&edit_delete)
        .build()?;

    let insert_text = item(app, "insert.text", "文本", Some("T"))?;
    let insert_note = item(app, "insert.note", "便签", Some("N"))?;
    let insert_arrow = item(app, "insert.arrow", "箭头", Some("A"))?;
    let insert_frame = item(app, "insert.frame", "框架", Some("F"))?;
    let insert_section = item(app, "insert.section", "分区", Some("Shift+S"))?;
    let insert_mindmap = item(app, "insert.mindmap", "脑图", Some("M"))?;
    let insert_image = item(app, "insert.image", "图片", Some("I"))?;
    let insert_menu = SubmenuBuilder::new(app, "插入")
        .item(&insert_text)
        .item(&insert_note)
        .item(&insert_arrow)
        .separator()
        .item(&insert_frame)
        .item(&insert_section)
        .item(&insert_mindmap)
        .item(&insert_image)
        .build()?;

    let arrange_forward = item(app, "arrange.forward", "前移一层", None)?;
    let arrange_backward = item(app, "arrange.backward", "后移一层", None)?;
    let arrange_front = item(app, "arrange.front", "置于顶层", None)?;
    let arrange_back = item(app, "arrange.back", "置于底层", None)?;
    let arrange_group = item(app, "arrange.group", "编组", Some("CmdOrCtrl+G"))?;
    let arrange_ungroup = item(app, "arrange.ungroup", "取消编组", Some("CmdOrCtrl+Shift+G"))?;
    let arrange_menu = SubmenuBuilder::new(app, "排列")
        .item(&arrange_forward)
        .item(&arrange_backward)
        .item(&arrange_front)
        .item(&arrange_back)
        .separator()
        .item(&arrange_group)
        .item(&arrange_ungroup)
        .build()?;

    let view_grid = item(app, "view.toggle_grid", "显示/隐藏网格", Some("Shift+G"))?;
    let view_dots = item(app, "view.toggle_dots", "显示/隐藏点阵背景", None)?;
    let view_reset = item(app, "view.reset", "重置视图", None)?;
    let view_fullscreen = PredefinedMenuItem::fullscreen(app, Some("切换全屏"))?;
    let view_menu = SubmenuBuilder::new(app, "视图")
        .item(&view_grid)
        .item(&view_dots)
        .item(&view_reset)
        .separator()
        .item(&view_fullscreen)
        .build()?;

    let window_minimize = PredefinedMenuItem::minimize(app, Some("最小化"))?;
    let window_maximize = PredefinedMenuItem::maximize(app, Some("缩放"))?;
    let window_menu = SubmenuBuilder::new(app, "窗口")
        .item(&window_minimize)
        .item(&window_maximize)
        .build()?;

    let help_about = item(app, "help.about", "关于 MixBoard", None)?;
    let help_menu = SubmenuBuilder::new(app, "帮助")
        .item(&help_about)
        .build()?;

    let menu = MenuBuilder::new(app)
        .items(&[
            &app_menu,
            &file_menu,
            &edit_menu,
            &insert_menu,
            &arrange_menu,
            &view_menu,
            &window_menu,
            &help_menu,
        ])
        .build()?;

    menu.set_as_app_menu()?;
    Ok(())
}

pub fn handle_event<R: Runtime>(app: &AppHandle<R>, id: &str) {
    if id == "app.quit" {
        // Raises ExitRequested, where quit::on_exit_requested flushes first.
        app.exit(0);
        return;
    }

    let should_emit = matches!(
        id,
        "file.new"
            | "file.open"
            | "file.save"
            | "file.export_png"
            | "file.export_md"
            | "edit.undo"
            | "edit.redo"
            | "edit.duplicate"
            | "edit.delete"
            | "insert.text"
            | "insert.note"
            | "insert.arrow"
            | "insert.frame"
            | "insert.section"
            | "insert.mindmap"
            | "insert.image"
            | "arrange.forward"
            | "arrange.backward"
            | "arrange.front"
            | "arrange.back"
            | "arrange.group"
            | "arrange.ungroup"
            | "view.toggle_grid"
            | "view.toggle_dots"
            | "view.reset"
            | "help.about"
    );

    if should_emit {
        let _ = app.emit(MENU_EVENT_NAME, id.to_string());
    }
}
