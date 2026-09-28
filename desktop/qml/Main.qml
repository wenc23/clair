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
    property string playbackMode: "列表循环"
    property string groupKind: "全部"
    property string selectedGroup: "全部曲目"
    property var groupNames: ["全部曲目"]
    property var visibleTracks: []
    property bool lyricsPage: false

    function formatTime(milliseconds) {
        const seconds = Math.floor(Math.max(0, milliseconds) / 1000)
        return Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0")
    }

    function playIndex(index) {
        if (index < 0 || index >= library.count)
            return
        selectedIndex = index
        player.source = library.sourceAt(index)
        lyrics.loadForTrack(player.source)
        player.play()
    }

    function rebuildGroups() {
        let names = []
        for (let i = 0; i < library.count; i++) {
            const name = library.groupAt(i, groupKind)
            if (names.indexOf(name) < 0) names.push(name)
        }
        names.sort((a, b) => a.localeCompare(b))
        groupNames = groupKind === "全部" ? ["全部曲目"] : ["全部曲目"].concat(names)
        if (groupNames.indexOf(selectedGroup) < 0) selectedGroup = "全部曲目"
        rebuildVisibleTracks()
    }

    function rebuildVisibleTracks() {
        let rows = []
        for (let i = 0; i < library.count; i++) {
            if (selectedGroup !== "全部曲目" && library.groupAt(i, groupKind) !== selectedGroup)
                continue
            rows.push({ trackIndex: i, title: library.titleAt(i),
                        artist: library.artistAt(i), album: library.albumAt(i) })
        }
        visibleTracks = rows
    }

    function advance(ended, backwards) {
        if (selectedIndex < 0 || library.count === 0) return
        if (ended && playbackMode === "单曲循环") {
            player.position = 0
            player.play()
            return
        }
        let pool = visibleTracks.map(row => row.trackIndex)
        if (pool.length === 0)
            pool = Array.from({length: library.count}, (_, i) => i)
        if (playbackMode === "组内随机" && !backwards) {
            if (pool.length > 1) pool = pool.filter(i => i !== selectedIndex)
            playIndex(pool[Math.floor(Math.random() * pool.length)])
            return
        }
        const current = pool.indexOf(selectedIndex)
        if (current < 0) { playIndex(pool[backwards ? pool.length - 1 : 0]); return }
        const next = current + (backwards ? -1 : 1)
        if (next >= 0 && next < pool.length) playIndex(pool[next])
        else if (playbackMode !== "顺序播放") playIndex(pool[backwards ? pool.length - 1 : 0])
        else player.stop()
    }

    FolderDialog {
        id: folderDialog
        title: "选择音乐目录"
        onAccepted: library.openFolder(selectedFolder)
    }

    FileDialog {
        id: audioDialog
        title: "导入任意位置的音乐文件（可多选）"
        fileMode: FileDialog.OpenFiles
        nameFilters: ["音乐文件 (*.mp3 *.flac *.wav)"]
        onAccepted: library.addFiles(selectedFiles)
    }

    FileDialog {
        id: lrcDialog
        title: "导入当前歌曲的 LRC 歌词"
        nameFilters: ["LRC 歌词 (*.lrc)"]
        onAccepted: lyrics.importLrc(selectedFile)
    }

    Dialog {
        id: sourceDialog
        title: "已记录的音乐来源"
        modal: true
        anchors.centerIn: parent
        width: Math.min(window.width - 60, 700)
        height: Math.min(window.height - 80, 500)
        standardButtons: Dialog.Close
        ColumnLayout {
            anchors.fill: parent
            RowLayout {
                Layout.fillWidth: true
                Label { Layout.fillWidth: true; text: library.rootDirectory || "未选择文件夹"; elide: Text.ElideMiddle }
                Button { text: "移除文件夹"; enabled: library.rootDirectory !== "" && !library.loading; onClicked: library.clearFolder() }
            }
            Label { text: "单独导入的文件：" }
            ScrollView {
                Layout.fillWidth: true
                Layout.fillHeight: true
                ListView {
                    model: library.importedFiles
                    delegate: RowLayout {
                        width: ListView.view.width
                        Label { Layout.fillWidth: true; text: modelData; elide: Text.ElideMiddle }
                        Button { text: "移除记录"; enabled: !library.loading; onClicked: library.removeImportedFile(modelData) }
                    }
                }
            }
            Label { text: "移除记录不会删除磁盘上的音乐文件。"; color: "#aab0b9" }
        }
    }

    Dialog {
        id: editDialog
        title: "编辑当前曲目"
        modal: true
        anchors.centerIn: parent
        standardButtons: Dialog.Save | Dialog.Cancel
        onOpened: {
            titleField.text = library.titleAt(selectedIndex)
            artistField.text = library.artistAt(selectedIndex)
            filenameField.text = ""
        }
        onAccepted: {
            if (library.editTrack(selectedIndex, titleField.text, artistField.text))
                rebuildGroups()
        }
        ColumnLayout {
            width: 430
            Label { text: "编辑显示信息：仅保存在 Clair，不修改音频标签。"; wrapMode: Text.Wrap }
            TextField { id: titleField; Layout.fillWidth: true; placeholderText: "歌名" }
            TextField { id: artistField; Layout.fillWidth: true; placeholderText: "歌手" }
            Label { text: "可选：修改磁盘文件名（不含扩展名，先停止播放）"; wrapMode: Text.Wrap }
            RowLayout {
                TextField { id: filenameField; Layout.fillWidth: true; placeholderText: "新的文件名" }
                Button {
                    text: "重命名文件"
                    enabled: filenameField.text.trim() !== ""
                    onClicked: {
                        player.stop()
                        player.source = ""
                        if (library.renameTrackFile(selectedIndex, filenameField.text)) {
                            lyrics.loadForTrack(library.sourceAt(selectedIndex))
                            rebuildGroups()
                            filenameField.text = ""
                        }
                    }
                }
            }
        }
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
            Label { text: "留空则使用试用包自带 Web 页面；也可填入自定义 HTTP(S) 地址。"; wrapMode: Text.Wrap }
            TextField {
                id: webAddress
                Layout.fillWidth: true
                placeholderText: "留空：使用内置 Web 页面"
            }
        }
    }

    MediaPlayer {
        id: player
        audioOutput: AudioOutput { id: audioOutput; volume: 1.0 }
        onMediaStatusChanged: {
            if (mediaStatus === MediaPlayer.EndOfMedia)
                window.advance(true, false)
        }
    }

    Connections {
        target: library
        function onScanStarted() {
            player.stop()
            window.selectedIndex = -1
            lyrics.loadForTrack("")
        }
        function onCountChanged() { window.rebuildGroups() }
    }

    Window {
        id: floatingLyrics
        title: "Clair · 浮动歌词"
        width: 550
        height: 110
        visible: false
        color: "#202631"
        flags: Qt.Window | Qt.WindowStaysOnTopHint
        Label {
            anchors.fill: parent
            anchors.margins: 16
            horizontalAlignment: Text.AlignHCenter
            verticalAlignment: Text.AlignVCenter
            wrapMode: Text.Wrap
            font.pixelSize: 22
            text: lyrics.lineAtPosition(player.position) || (lyrics.plainText ? lyrics.plainText.split("\n")[0] : "暂无同步歌词")
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
                text: library.loading ? "扫描中…" : "选文件夹"
                enabled: !library.loading
                onClicked: folderDialog.open()
            }
            Button { text: "导入文件"; enabled: !library.loading; onClicked: audioDialog.open() }
            Button { text: "管理来源"; onClicked: sourceDialog.open() }
            Button {
                text: "打开 Web 版"
                onClicked: desktopSettings.openWebVersion()
                ToolTip.visible: hovered
                ToolTip.text: "打开试用包自带的 Web 页面；桌面播放不依赖它"
            }
            Button { text: "Web 设置"; onClicked: webSettingsDialog.open() }
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
                    text: library.sourceSummary
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

        RowLayout {
            Layout.fillWidth: true
            Button { text: "曲库"; highlighted: !lyricsPage; onClicked: lyricsPage = false }
            Button { text: "歌词"; highlighted: lyricsPage; onClicked: lyricsPage = true }
            Item { Layout.fillWidth: true }
            Button { text: "编辑曲目"; enabled: selectedIndex >= 0; onClicked: editDialog.open() }
        }

        Rectangle {
            Layout.fillWidth: true
            Layout.fillHeight: true
            radius: 12
            color: "#171c24"
            border.color: "#303946"

            RowLayout {
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.top: parent.top
                anchors.margins: 10
                visible: !lyricsPage
                Label { text: "分组" }
                ComboBox {
                    model: ["全部", "文件夹", "艺术家", "专辑"]
                    onActivated: {
                        window.groupKind = currentText
                        window.selectedGroup = "全部曲目"
                        window.rebuildGroups()
                    }
                }
                ComboBox {
                    Layout.fillWidth: true
                    model: window.groupNames
                    onActivated: {
                        window.selectedGroup = currentText
                        window.rebuildVisibleTracks()
                    }
                }
            }

            ListView {
                id: trackList
                anchors.fill: parent
                anchors.margins: 10
                anchors.topMargin: 62
                visible: !lyricsPage
                clip: true
                spacing: 3
                model: window.visibleTracks
                enabled: !library.loading

                delegate: Rectangle {
                    required property var modelData
                    width: trackList.width
                    height: 60
                    radius: 7
                    color: modelData.trackIndex === window.selectedIndex ? "#39404a" : (mouse.containsMouse ? "#252c36" : "transparent")

                    RowLayout {
                        anchors.fill: parent
                        anchors.leftMargin: 12
                        anchors.rightMargin: 12
                        spacing: 12
                        Label { text: String(modelData.trackIndex + 1).padStart(2, "0"); color: "#8c97a4"; Layout.preferredWidth: 34 }
                        ColumnLayout {
                            Layout.fillWidth: true
                            spacing: 2
                            Label { Layout.fillWidth: true; text: modelData.title; elide: Text.ElideRight; font.bold: true }
                            Label { Layout.fillWidth: true; text: modelData.artist + "  ·  " + modelData.album; color: "#aab0b9"; elide: Text.ElideRight }
                        }
                    }
                    MouseArea {
                        id: mouse
                        anchors.fill: parent
                        hoverEnabled: true
                        onClicked: {
                            window.playIndex(modelData.trackIndex)
                        }
                    }
                }

                Label {
                    anchors.centerIn: parent
                    visible: !library.loading && window.visibleTracks.length === 0
                    text: library.count === 0 ? "选择文件夹或导入任意位置的文件" : "此分组暂无曲目"
                    color: "#aab0b9"
                }
                BusyIndicator { anchors.centerIn: parent; running: library.loading; visible: running }
            }

            ColumnLayout {
                anchors.fill: parent
                anchors.margins: 12
                visible: lyricsPage
                RowLayout {
                    Layout.fillWidth: true
                    Label { Layout.fillWidth: true; text: lyrics.status; wrapMode: Text.Wrap; color: "#aab0b9" }
                    Button { text: "导入 LRC"; enabled: selectedIndex >= 0; onClicked: lrcDialog.open() }
                    Button { text: "搜索歌词"; enabled: selectedIndex >= 0; onClicked: lyrics.search(library.titleAt(selectedIndex), library.artistAt(selectedIndex)) }
                    Button { text: floatingLyrics.visible ? "关闭浮窗" : "歌词浮窗"; onClicked: floatingLyrics.visible = !floatingLyrics.visible }
                }
                ScrollView {
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    ColumnLayout {
                        width: Math.max(200, parent.width - 24)
                        Repeater {
                            model: lyrics.candidates
                            delegate: Button {
                                required property var modelData
                                required property int index
                                Layout.fillWidth: true
                                text: modelData.label + (modelData.synced ? " · 同步" : " · 纯文本")
                                onClicked: lyrics.chooseCandidate(index)
                            }
                        }
                        Repeater {
                            model: lyrics.lines
                            delegate: Label {
                                required property var modelData
                                required property int index
                                Layout.fillWidth: true
                                text: modelData.text || "♪"
                                horizontalAlignment: Text.AlignHCenter
                                font.pixelSize: 19
                                color: lyrics.lineIndexAtPosition(player.position) === index ? "#f6e8d9" : "#8c97a4"
                            }
                        }
                        Label {
                            Layout.fillWidth: true
                            visible: lyrics.lines.length === 0
                            text: lyrics.plainText || "暂无歌词。可导入 LRC，或编辑歌名/歌手后搜索。"
                            wrapMode: Text.Wrap
                            horizontalAlignment: Text.AlignHCenter
                            color: "#aab0b9"
                        }
                    }
                }
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
                    Button { text: "上一首"; enabled: selectedIndex >= 0; onClicked: advance(false, true) }
                    Button {
                        text: player.playbackState === MediaPlayer.PlayingState ? "暂停" : "播放"
                        enabled: player.source.toString() !== ""
                        onClicked: player.playbackState === MediaPlayer.PlayingState ? player.pause() : player.play()
                    }
                    Button { text: "下一首"; enabled: selectedIndex >= 0; onClicked: advance(false, false) }
                    Item { Layout.fillWidth: true }
                    ComboBox {
                        model: ["顺序播放", "列表循环", "单曲循环", "组内随机"]
                        currentIndex: 1
                        onActivated: playbackMode = currentText
                    }
                    Label { text: "音量"; color: "#aab0b9" }
                    Slider { Layout.preferredWidth: 130; from: 0; to: 1; value: audioOutput.volume; onMoved: audioOutput.volume = value }
                }
            }
        }
    }
}
