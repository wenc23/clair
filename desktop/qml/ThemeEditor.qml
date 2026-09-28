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
        nameFilters: ["图片 (*.png *.jpg *.jpeg *.bmp)"]
        onAccepted: {
            if (themeManager.createTheme(nameField.text, selectedFiles))
                editor.resetSelection()
        }
    }
    FileDialog {
        id: packDialog
        title: "导入 AI 裁剪主题包的 manifest.json"
        nameFilters: ["主题清单 (manifest.json)", "JSON (*.json)"]
        onAccepted: {
            if (themeManager.importThemePack(selectedFile)) editor.resetSelection()
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
            Button { text: "导入图片组"; onClicked: imagesDialog.open() }
            Button { text: "导入 AI 主题包"; onClicked: packDialog.open() }
            Button { text: "恢复默认"; onClicked: themeManager.activateTheme("") }
        }
        Label {
            Layout.fillWidth: true
            text: "原图会保留；裁剪仅生成新的 PNG，不修改你的图片。1–3 张图按背景、封面、侧栏顺序分配；不足 3 张时复用最后一张。"
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
