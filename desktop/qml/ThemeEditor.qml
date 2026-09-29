import QtQuick
import QtQuick.Controls
import QtQuick.Controls.Material
import QtQuick.Dialogs
import QtQuick.Layouts

Dialog {
    id: editor
    Material.theme: Material.Dark
    Material.accent: "#d9a980"
    objectName: "themeEditor"
    title: "图片组主题设计"
    modal: true
    width: Math.min(parent ? parent.width - 48 : 980, 1050)
    height: Math.min(parent ? parent.height - 48 : 720, 760)
    anchors.centerIn: parent
    standardButtons: Dialog.Close

    property string slot: "background"
    property real centerX: 0.5
    property real centerY: 0.5
    property real zoom: 1.0
    readonly property var spec: themeManager.slotSpec(slot)
    readonly property real sourceAspect: originalImage.implicitHeight > 0
                                         ? originalImage.implicitWidth / originalImage.implicitHeight : 1
    readonly property real cropWidth: Math.min(1, spec.aspect / sourceAspect) * zoom
    readonly property real cropHeight: Math.min(1, sourceAspect / spec.aspect) * zoom
    readonly property real cropX: Math.max(0, Math.min(1 - cropWidth, centerX - cropWidth / 2))
    readonly property real cropY: Math.max(0, Math.min(1 - cropHeight, centerY - cropHeight / 2))

    function resetSelection() {
        centerX = 0.5
        centerY = 0.5
        zoom = 1.0
    }

    FileDialog {
        id: imagesDialog
        title: "选择主题图片组（顺序：背景、封面、侧栏）"
        fileMode: FileDialog.OpenFiles
        nameFilters: ["支持的图片：PNG、JPG/JPEG、BMP (*.png *.jpg *.jpeg *.bmp)"]
        onAccepted: {
            const imageUrls = []
            for (let i = 0; i < selectedFiles.length; i++)
                imageUrls.push(selectedFiles[i].toString())
            if (themeManager.createTheme(nameField.text, imageUrls))
                editor.resetSelection()
            else
                imageImportError.open()
        }
    }
    MessageDialog {
        id: imageImportError
        title: "图片无法导入"
        text: themeManager.errorString
        buttons: MessageDialog.Ok
    }
    FileDialog {
        id: packDialog
        title: "导入 AI 裁剪主题包的 manifest.json"
        nameFilters: ["主题清单 (manifest.json)", "JSON (*.json)"]
        onAccepted: {
            if (themeManager.importThemePack(selectedFile)) editor.resetSelection()
            else packImportError.open()
        }
    }
    MessageDialog {
        id: packImportError
        title: "主题包无法导入"
        text: themeManager.errorString
        buttons: MessageDialog.Ok
    }
    Dialog {
        id: aiGuideDialog
        objectName: "aiThemeGuide"
        title: "先让 AI 制作主题包"
        modal: true
        width: Math.min(editor.width - 36, 760)
        height: Math.min(editor.height - 36, 560)
        anchors.centerIn: parent
        standardButtons: Dialog.Close
        property bool copied: false
        ColumnLayout {
            anchors.fill: parent
            spacing: 10
            Label {
                Layout.fillWidth: true
                text: "先把参考图片和下方提示词发给 AI。AI 输出一个文件夹后，在这里选择其中的 manifest.json。"
                wrapMode: Text.Wrap
            }
            ScrollView {
                Layout.fillWidth: true
                Layout.fillHeight: true
                TextArea {
                    id: aiPromptArea
                    readOnly: true
                    wrapMode: TextEdit.Wrap
                    font.pixelSize: 14
                    padding: 12
                    text: "请根据我提供的 1–3 张参考图片，为 Clair Desktop 制作 v1 图片组主题包。\n\n"
                          + "目标尺寸：背景 background 1920×1080、封面 cover 600×600、侧栏 sidebar 480×1080。"
                          + "第 1 张图给背景，第 2 张给封面，第 3 张给侧栏；不足 3 张时复用最后一张。"
                          + "请智能选择裁剪区域，保留主体、人脸和重要文字，避免拉伸；先给我看三张裁剪预览。\n\n"
                          + "请保留原图不变，在同一个输出文件夹内放 manifest.json 和所引用的原图副本，"
                          + "例如 original-0.jpg（也可按原图格式使用 .png 或 .bmp）。"
                          + "manifest.json 的 version 必须为 1；slots 包含 background、cover、sidebar。"
                          + "每个槽位写入 original 文件名、output（分别为 background.png、cover.png、sidebar.png）、"
                          + "crop（相对原图的 [x,y,w,h]，每项 0–1）、width 和 height。"
                          + "裁剪图统一为 PNG，尺寸必须与目标尺寸一致。不要只交三张 PNG 而缺少 manifest.json 和原图副本。\n\n"
                          + "如果可以访问 Clair 随包的 theme-skill，请优先按 SKILL.md 使用 crop_theme.py 导出，"
                          + "并检查 manifest、原图引用与三张预览图。完成后告诉我 manifest.json 的位置。"
                }
            }
            RowLayout {
                Layout.fillWidth: true
                Button {
                    text: aiGuideDialog.copied ? "已复制提示词" : "复制提示词"
                    onClicked: {
                        aiPromptArea.selectAll()
                        aiPromptArea.copy()
                        aiPromptArea.deselect()
                        aiGuideDialog.copied = true
                    }
                }
                Item { Layout.fillWidth: true }
                Button {
                    text: "选择 manifest.json 导入"
                    onClicked: {
                        aiGuideDialog.close()
                        packDialog.open()
                    }
                }
            }
        }
    }

    ColumnLayout {
        anchors.fill: parent
        spacing: 10
        RowLayout {
            Layout.fillWidth: true
            TextField {
                id: nameField
                Layout.fillWidth: true
                placeholderText: "新主题名称"
                text: "我的主题"
            }
            Button { text: "选择原图（PNG/JPG/BMP）"; onClicked: imagesDialog.open() }
            Button { text: "用 AI 制作/导入主题包"; onClicked: aiGuideDialog.open() }
            Button { text: "恢复默认"; onClicked: themeManager.activateTheme("") }
        }
        Label {
            Layout.fillWidth: true
            text: "可导入 PNG、JPG/JPEG、BMP 原图；裁剪后统一生成 PNG 主题图，原图不变。WebP/HEIC 暂不支持。1–3 张图依次作为背景、封面、侧栏；不足时复用最后一张。"
            wrapMode: Text.Wrap
            color: "#aeb8c4"
        }
        RowLayout {
            Layout.fillWidth: true
            Layout.fillHeight: true
            spacing: 12
            Frame {
                Layout.preferredWidth: 195
                Layout.fillHeight: true
                ColumnLayout {
                    anchors.fill: parent
                    Label { text: "已保存主题"; font.bold: true }
                    ScrollView {
                        Layout.fillWidth: true
                        Layout.fillHeight: true
                        ListView {
                            model: themeManager.themeIds
                            delegate: Button {
                                width: ListView.view.width
                                text: themeManager.themeName(modelData)
                                highlighted: modelData === themeManager.activeThemeId
                                onClicked: { themeManager.activateTheme(modelData); editor.resetSelection() }
                            }
                        }
                    }
                    Button {
                        text: "删除当前主题"
                        enabled: themeManager.activeThemeId !== ""
                        onClicked: themeManager.removeTheme(themeManager.activeThemeId)
                    }
                }
            }
            ColumnLayout {
                Layout.fillWidth: true
                Layout.fillHeight: true
                TabBar {
                    Layout.fillWidth: true
                    currentIndex: slot === "background" ? 0 : slot === "cover" ? 1 : 2
                    TabButton { text: "背景 1920×1080"; onClicked: { editor.slot = "background"; editor.resetSelection() } }
                    TabButton { text: "封面 600×600"; onClicked: { editor.slot = "cover"; editor.resetSelection() } }
                    TabButton { text: "侧栏 480×1080"; onClicked: { editor.slot = "sidebar"; editor.resetSelection() } }
                }
                Rectangle {
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    color: "#0b0d11"
                    radius: 8
                    clip: true
                    Image {
                        id: originalImage
                        anchors.fill: parent
                        anchors.margins: 12
                        source: themeManager.originalForSlot(editor.slot)
                        fillMode: Image.PreserveAspectFit
                        autoTransform: true
                        asynchronous: true
                        cache: false
                    }
                    Item {
                        id: imageSurface
                        x: originalImage.x + (originalImage.width - originalImage.paintedWidth) / 2
                        y: originalImage.y + (originalImage.height - originalImage.paintedHeight) / 2
                        width: originalImage.paintedWidth
                        height: originalImage.paintedHeight
                        visible: originalImage.status === Image.Ready
                        Rectangle {
                            x: editor.cropX * imageSurface.width
                            y: editor.cropY * imageSurface.height
                            width: editor.cropWidth * imageSurface.width
                            height: editor.cropHeight * imageSurface.height
                            color: "#22ffffff"
                            border.color: "#ffb876"
                            border.width: 2
                        }
                        MouseArea {
                            anchors.fill: parent
                            cursorShape: Qt.CrossCursor
                            onPressed: moveSelection(mouse.x, mouse.y)
                            onPositionChanged: if (pressed) moveSelection(mouse.x, mouse.y)
                            function moveSelection(px, py) {
                                editor.centerX = Math.max(editor.cropWidth / 2,
                                    Math.min(1 - editor.cropWidth / 2, px / imageSurface.width))
                                editor.centerY = Math.max(editor.cropHeight / 2,
                                    Math.min(1 - editor.cropHeight / 2, py / imageSurface.height))
                            }
                        }
                    }
                    Label {
                        anchors.centerIn: parent
                        visible: themeManager.activeThemeId === ""
                        text: "先导入图片组，再在原图上拖动裁剪框"
                        color: "#d4d8dd"
                    }
                }
                RowLayout {
                    Layout.fillWidth: true
                    Label { text: "裁剪范围" }
                    Slider {
                        Layout.fillWidth: true
                        from: 0.15
                        to: 1.0
                        value: editor.zoom
                        onMoved: editor.zoom = value
                    }
                    Button {
                        text: "应用裁剪"
                        enabled: themeManager.activeThemeId !== "" && originalImage.status === Image.Ready
                        onClicked: themeManager.cropSlot(editor.slot, editor.cropX, editor.cropY,
                                                         editor.cropWidth, editor.cropHeight)
                    }
                }
                Label {
                    Layout.fillWidth: true
                    text: themeManager.errorString !== "" ? themeManager.errorString
                          : "拖动原图上的选框定位；调节滑块缩放。输出尺寸固定为 "
                            + spec.width + "×" + spec.height + "。"
                    color: themeManager.errorString !== "" ? "#ff8c82" : "#aeb8c4"
                    wrapMode: Text.Wrap
                }
            }
        }
    }
}
