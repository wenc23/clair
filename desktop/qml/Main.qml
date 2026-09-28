import QtQuick
import QtQuick.Controls
import QtQuick.Controls.Material
import QtQuick.Dialogs
import QtQuick.Layouts
import QtMultimedia

ApplicationWindow {
    id: window
    visible: true
    width: 1120
    height: 760
    minimumWidth: 720
    minimumHeight: 520
    title: "Clair Desktop"
    color: "#11141b"
    Material.theme: Material.Dark
    Material.accent: "#d9a980"

    property int selectedIndex: -1

    function formatTime(milliseconds) {
        const seconds = Math.floor(Math.max(0, milliseconds) / 1000)
        return Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0")
    }

    function playIndex(index) {
        if (index < 0 || index >= library.count)
            return
        selectedIndex = index
        player.source = library.sourceAt(index)
        player.play()
    }

    Component.onCompleted: {
        if (desktopSettings.lastLibraryFolder.toString() !== "")
            library.openFolder(desktopSettings.lastLibraryFolder)
    }

    FolderDialog {
        id: folderDialog
        title: "选择音乐目录"
        onAccepted: library.openFolder(selectedFolder)
    }

    Dialog {
        id: webSettingsDialog
        title: "Web 版地址"
        modal: true
        anchors.centerIn: parent
        standardButtons: Dialog.Ok | Dialog.Cancel
        onOpened: webAddress.text = desktopSettings.webUrl
        onAccepted: desktopSettings.webUrl = webAddress.text.trim()
        ColumnLayout {
            width: 360
            Label { text: "Web 版须单独启动；桌面播放不依赖此地址。"; wrapMode: Text.Wrap }
            TextField {
                id: webAddress
                Layout.fillWidth: true
                placeholderText: "http://127.0.0.1:8000"
            }
        }
    }

    MediaPlayer {
        id: player
        audioOutput: AudioOutput { id: audioOutput; volume: 0.7 }
        onMediaStatusChanged: {
            if (mediaStatus === MediaPlayer.EndOfMedia && selectedIndex + 1 < library.count)
                playIndex(selectedIndex + 1)
        }
    }

    Connections {
        target: library
        function onScanStarted() {
            player.stop()
            window.selectedIndex = -1
        }
    }

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 24
        spacing: 16

        RowLayout {
            Layout.fillWidth: true
            spacing: 12

            ColumnLayout {
                spacing: 2
                Label { text: "CLAIR"; font.pixelSize: 29; font.bold: true; color: "#f6e8d9" }
                Label { text: "原生音乐播放器 · 任意流派"; color: "#aab0b9" }
            }
            Item { Layout.fillWidth: true }
            Button {
                text: library.loading ? "扫描中…" : "选择音乐目录"
                enabled: !library.loading
                onClicked: folderDialog.open()
            }
            Button {
                text: "打开 Web 版"
                onClicked: desktopSettings.openWebVersion()
                ToolTip.visible: hovered
                ToolTip.text: "Web 版需另行启动；桌面播放不依赖它"
            }
            Button { text: "Web 地址"; onClicked: webSettingsDialog.open() }
        }

        Rectangle {
            Layout.fillWidth: true
            Layout.preferredHeight: 66
            radius: 10
            color: "#1b2029"
            border.color: "#303946"
            RowLayout {
                anchors.fill: parent
                anchors.margins: 12
                spacing: 12
                Label { text: "曲库"; font.bold: true }
                Label {
                    Layout.fillWidth: true
                    text: library.rootDirectory || "尚未选择目录"
                    color: "#aab0b9"
                    elide: Text.ElideMiddle
                }
                Label { text: library.count + " 首"; color: "#d9a980" }
            }
        }

        Label {
            Layout.fillWidth: true
            visible: text !== ""
            color: "#f3a29d"
            wrapMode: Text.Wrap
            text: library.errorString || desktopSettings.errorString || player.errorString
        }

        Rectangle {
            Layout.fillWidth: true
            Layout.fillHeight: true
            radius: 12
            color: "#171c24"
            border.color: "#303946"

            ListView {
                id: trackList
                anchors.fill: parent
                anchors.margins: 10
                clip: true
                spacing: 3
                model: library
                enabled: !library.loading

                delegate: Rectangle {
                    required property int index
                    required property string title
                    required property string artist
                    required property string album
                    width: trackList.width
                    height: 60
                    radius: 7
                    color: index === window.selectedIndex ? "#39404a" : (mouse.containsMouse ? "#252c36" : "transparent")

                    RowLayout {
                        anchors.fill: parent
                        anchors.leftMargin: 12
                        anchors.rightMargin: 12
                        spacing: 12
                        Label { text: String(index + 1).padStart(2, "0"); color: "#8c97a4"; Layout.preferredWidth: 34 }
                        ColumnLayout {
                            Layout.fillWidth: true
                            spacing: 2
                            Label { Layout.fillWidth: true; text: title; elide: Text.ElideRight; font.bold: true }
                            Label { Layout.fillWidth: true; text: artist + "  ·  " + album; color: "#aab0b9"; elide: Text.ElideRight }
                        }
                    }
                    MouseArea {
                        id: mouse
                        anchors.fill: parent
                        hoverEnabled: true
                        onClicked: {
                            window.playIndex(index)
                        }
                    }
                }

                Label {
                    anchors.centerIn: parent
                    visible: !library.loading && library.count === 0
                    text: library.rootDirectory ? "没有找到 FLAC、MP3 或 WAV 曲目" : "选择目录，开始聆听"
                    color: "#aab0b9"
                }
                BusyIndicator { anchors.centerIn: parent; running: library.loading; visible: running }
            }
        }

        Rectangle {
            Layout.fillWidth: true
            Layout.preferredHeight: 146
            radius: 12
            color: "#202631"
            border.color: "#303946"

            ColumnLayout {
                anchors.fill: parent
                anchors.margins: 12
                spacing: 4
                RowLayout {
                    Layout.fillWidth: true
                    Label {
                        Layout.fillWidth: true
                        text: window.selectedIndex >= 0 ? library.titleAt(window.selectedIndex) : "尚未播放"
                        elide: Text.ElideRight
                        font.bold: true
                    }
                    Label { text: formatTime(player.position) + " / " + formatTime(player.duration); color: "#aab0b9" }
                }
                Slider {
                    Layout.fillWidth: true
                    from: 0
                    to: Math.max(1, player.duration)
                    value: player.position
                    onMoved: player.position = value
                }
                RowLayout {
                    Layout.fillWidth: true
                    spacing: 10
                    Button { text: "上一首"; enabled: selectedIndex > 0; onClicked: playIndex(selectedIndex - 1) }
                    Button {
                        text: player.playbackState === MediaPlayer.PlayingState ? "暂停" : "播放"
                        enabled: player.source.toString() !== ""
                        onClicked: player.playbackState === MediaPlayer.PlayingState ? player.pause() : player.play()
                    }
                    Button { text: "下一首"; enabled: selectedIndex >= 0 && selectedIndex + 1 < library.count; onClicked: playIndex(selectedIndex + 1) }
                    Item { Layout.fillWidth: true }
                    Label { text: "音量"; color: "#aab0b9" }
                    Slider { Layout.preferredWidth: 130; from: 0; to: 1; value: audioOutput.volume; onMoved: audioOutput.volume = value }
                }
            }
        }
    }
}
