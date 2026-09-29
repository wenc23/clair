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
    background: Rectangle {
        color: "#11141b"
        Image {
            anchors.fill: parent
            source: themeManager.backgroundUrl
            fillMode: Image.PreserveAspectCrop
            cache: false
            opacity: 0.28
        }
    }
    Material.theme: Material.Dark
    Material.accent: "#d9a980"

    property int selectedIndex: -1
    property string playbackMode: "列表循环"
    property string groupKind: "全部"
    property string selectedGroup: "全部曲目"
    property var groupNames: ["全部曲目"]
    property var visibleTracks: []
    property bool lyricsPage: false
    property string transcriptionTarget: ""

    ThemeEditor { id: themeEditor }

    function formatTime(milliseconds) {
        const seconds = Math.floor(Math.max(0, milliseconds) / 1000)
        return Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0")
    }

    function playIndex(index) {
        if (index < 0 || index >= library.count)
            return
        fingerprint.cancel()
        selectedIndex = index
        player.source = library.sourceAt(index)
        lyrics.loadForTrack(player.source)
        player.play()
    }

    function openTrackFolder(index) {
        // Release the media handle first so Explorer can move or delete the file.
        if (index === selectedIndex) {
            player.stop()
            player.source = ""
        }
        library.openTrackFolder(index)
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

    FileDialog {
        id: whisperDialog
        title: "选择 whisper.cpp 的 whisper-cli 可执行文件"
        onAccepted: transcription.whisperExecutable = selectedFile
    }
    FileDialog {
        id: modelDialog
        title: "选择兼容的多语种 ggml 模型"
        onAccepted: transcription.modelFile = selectedFile
    }

    Dialog {
        id: fingerprintDialog
        title: "通过音频指纹匹配歌名"
        modal: true
        anchors.centerIn: parent
        width: Math.min(window.width - 70, 620)
        height: Math.min(window.height - 80, 500)
        standardButtons: Dialog.Close
        ColumnLayout {
            anchors.fill: parent
            Label {
                Layout.fillWidth: true
                text: "仅在点击匹配后上传音频指纹与时长，不上传原音频；结果需你确认。"
                wrapMode: Text.Wrap
            }
            TextField {
                id: fpcalcPath
                Layout.fillWidth: true
                text: fingerprint.fpcalcExecutable
                placeholderText: "fpcalc，或其可执行文件的绝对路径"
                onEditingFinished: fingerprint.fpcalcExecutable = text.trim()
            }
            TextField {
                id: acoustidKey
                Layout.fillWidth: true
                echoMode: TextInput.Password
                placeholderText: "你的 AcoustID API key（不会保存）"
            }
            RowLayout {
                Button {
                    text: "开始匹配"
                    enabled: selectedIndex >= 0 && !fingerprint.busy
                    onClicked: {
                        fingerprint.fpcalcExecutable = fpcalcPath.text.trim()
                        const key = acoustidKey.text
                        acoustidKey.text = ""
                        fingerprint.identify(library.sourceAt(selectedIndex), key)
                    }
                }
                Button { text: "取消"; enabled: fingerprint.busy; onClicked: fingerprint.cancel() }
                Label { Layout.fillWidth: true; text: fingerprint.status; wrapMode: Text.Wrap; color: "#aab0b9" }
            }
            ScrollView {
                Layout.fillWidth: true
                Layout.fillHeight: true
                ListView {
                    model: fingerprint.candidates
                    spacing: 4
                    delegate: Button {
                        required property int index
                        required property var modelData
                        width: ListView.view.width
                        text: modelData.title + " — " + modelData.artist + "  (" + Math.round(modelData.score * 100) + "%)"
                        onClicked: {
                            fingerprint.chooseCandidate(index)
                            fingerprintDialog.close()
                        }
                    }
                }
            }
        }
    }

    Dialog {
        id: transcriptionDialog
        property bool advancedTools: false
        title: "本机歌词转写"
        modal: true
        anchors.centerIn: parent
        width: Math.min(window.width - 70, 660)
        standardButtons: Dialog.Close
        ColumnLayout {
            width: transcriptionDialog.width - 40
            Label {
                Layout.fillWidth: true
                text: "点击开始即可用内置轻量模型生成 LRC 草稿，不上传音频。歌曲伴奏可能造成错词或漏词，请人工校对。"
                wrapMode: Text.Wrap
            }
            Label {
                Layout.fillWidth: true
                text: transcription.ready ? "内置离线转写已就绪" : "内置组件缺失：请解压完整试用包"
                color: transcription.ready ? "#a6d9ae" : "#f3a29d"
            }
            RowLayout {
                Layout.fillWidth: true
                Button {
                    text: "开始转写"
                    enabled: selectedIndex >= 0 && !transcription.busy && transcription.ready
                    onClicked: {
                        window.transcriptionTarget = library.sourceAt(selectedIndex).toString()
                        transcription.transcribe(library.sourceAt(selectedIndex))
                    }
                }
                Button { text: "取消任务"; enabled: transcription.busy; onClicked: transcription.cancel() }
            }
            Label { Layout.fillWidth: true; text: transcription.status; wrapMode: Text.Wrap; color: "#aab0b9" }
            Button {
                text: transcriptionDialog.advancedTools ? "收起高级设置" : "高级设置（可选）"
                onClicked: transcriptionDialog.advancedTools = !transcriptionDialog.advancedTools
            }
            RowLayout {
                Layout.fillWidth: true
                visible: transcriptionDialog.advancedTools
                Label { Layout.fillWidth: true; text: transcription.whisperExecutable.toString(); elide: Text.ElideMiddle }
                Button { text: "自选识别程序"; onClicked: whisperDialog.open() }
            }
            RowLayout {
                Layout.fillWidth: true
                visible: transcriptionDialog.advancedTools
                Label { Layout.fillWidth: true; text: transcription.modelFile.toString(); elide: Text.ElideMiddle }
                Button { text: "自选模型"; onClicked: modelDialog.open() }
            }
            Button {
                visible: transcriptionDialog.advancedTools
                text: "恢复内置组件"
                onClicked: transcription.useBundledTools()
            }
        }
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
            Button { text: "按音频指纹匹配歌名…"; onClicked: fingerprintDialog.open() }
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
        audioOutput: AudioOutput { id: audioOutput; volume: desktopSettings.volume }
        onMediaStatusChanged: {
            if (mediaStatus === MediaPlayer.EndOfMedia)
                window.advance(true, false)
        }
    }

    Connections {
        target: library
        function onScanStarted() {
            player.stop()
            fingerprint.cancel()
            window.selectedIndex = -1
            lyrics.loadForTrack("")
        }
        function onCountChanged() { window.rebuildGroups() }
    }
    Connections {
        target: fingerprint
        function onProposalSelected(audio, title, artist) {
            if (window.selectedIndex >= 0 &&
                audio.toString() === library.sourceAt(window.selectedIndex).toString() &&
                library.editTrack(window.selectedIndex, title, artist))
                window.rebuildGroups()
        }
    }
    Connections {
        target: transcription
        function onCompleted(lrcFile, fromCache) {
            if (window.selectedIndex >= 0 &&
                window.transcriptionTarget === library.sourceAt(window.selectedIndex).toString()) {
                lyrics.importLrc(lrcFile)
                window.lyricsPage = true
            }
        }
    }

    Window {
        id: floatingLyrics
        objectName: "floatingLyrics"
        property bool previewControls: false
        title: "Clair · 浮动歌词"
        width: 660
        height: 126
        x: window.x + (window.width - width) / 2
        y: window.y + window.height - height - 150
        visible: false
        color: "transparent"
        Material.theme: Material.Dark
        Material.accent: "#d9a980"
        flags: Qt.Tool | Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint |
               (desktopSettings.lyricsOverlayLocked ? Qt.WindowTransparentForInput : 0)
        Rectangle {
            anchors.fill: parent
            radius: 14
            color: Qt.rgba(0.08, 0.10, 0.15, desktopSettings.lyricsOverlayOpacity)
            border.color: Qt.rgba(1, 1, 1, Math.min(0.24, desktopSettings.lyricsOverlayOpacity / 2))
            HoverHandler { id: overlayHover }
            Label {
                id: overlayLine
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.top: parent.top
                height: 74
                anchors.margins: 12
                horizontalAlignment: Text.AlignHCenter
                verticalAlignment: Text.AlignVCenter
                wrapMode: Text.Wrap
                font.pixelSize: 24
                font.bold: true
                color: "#fff4e8"
                style: Text.Outline
                styleColor: "#b0000000"
                text: lyrics.lineAtPosition(player.position) ||
                      (lyrics.plainText ? lyrics.plainText.split("\n")[0] : "暂无歌词 · 可在主窗口导入或搜索")
                MouseArea {
                    anchors.fill: parent
                    enabled: !desktopSettings.lyricsOverlayLocked
                    hoverEnabled: true
                    cursorShape: Qt.SizeAllCursor
                    onPressed: floatingLyrics.startSystemMove()
                    ToolTip.visible: containsMouse
                    ToolTip.text: "按住拖动歌词浮窗"
                }
            }
            RowLayout {
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.bottom: parent.bottom
                anchors.margins: 8
                height: 42
                visible: !desktopSettings.lyricsOverlayLocked && (overlayHover.hovered || floatingLyrics.previewControls)
                spacing: 6
                ToolButton { text: "上一首"; Material.foreground: "#fff4e8"; enabled: selectedIndex >= 0; onClicked: advance(false, true) }
                ToolButton {
                    text: player.playbackState === MediaPlayer.PlayingState ? "暂停" : "播放"
                    Material.foreground: "#fff4e8"
                    enabled: player.source.toString() !== ""
                    onClicked: player.playbackState === MediaPlayer.PlayingState ? player.pause() : player.play()
                    ToolTip.text: "播放/暂停"
                    ToolTip.visible: hovered
                }
                ToolButton { text: "下一首"; Material.foreground: "#fff4e8"; enabled: selectedIndex >= 0; onClicked: advance(false, false) }
                Label { text: "音量"; font.pixelSize: 12; color: "#fff4e8" }
                Slider { Layout.preferredWidth: 102; from: 0; to: 1; value: desktopSettings.volume; onMoved: desktopSettings.volume = value }
                Label { text: "底色"; font.pixelSize: 12; color: "#fff4e8" }
                Slider { Layout.preferredWidth: 84; from: 0; to: 0.9; value: desktopSettings.lyricsOverlayOpacity; onMoved: desktopSettings.lyricsOverlayOpacity = value }
                Item { Layout.fillWidth: true }
                ToolButton { text: "锁定"; Material.foreground: "#fff4e8"; onClicked: desktopSettings.lyricsOverlayLocked = true; ToolTip.text: "锁定后鼠标点击会穿透浮窗；在主窗口解锁"; ToolTip.visible: hovered }
                ToolButton { text: "关闭"; Material.foreground: "#fff4e8"; onClicked: floatingLyrics.visible = false }
            }
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
            Button { text: "主题设计"; onClicked: themeEditor.open() }
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
                Button {
                    text: "刷新曲库"
                    enabled: !library.loading && library.sourceSummary !== "尚未添加音乐来源"
                    onClicked: library.refresh()
                    ToolTip.visible: hovered
                    ToolTip.text: "在文件管理器删除音乐后，点这里更新曲目列表"
                }
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

            Image {
                anchors.top: parent.top
                anchors.bottom: parent.bottom
                anchors.right: parent.right
                width: 150
                source: themeManager.sidebarUrl
                fillMode: Image.PreserveAspectCrop
                cache: false
                opacity: 0.14
            }

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

                    MouseArea {
                        id: mouse
                        anchors.fill: parent
                        hoverEnabled: true
                        onClicked: window.playIndex(modelData.trackIndex)
                    }
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
                        Button {
                            text: "打开文件夹"
                            onClicked: window.openTrackFolder(modelData.trackIndex)
                            ToolTip.visible: hovered
                            ToolTip.text: "打开原文件所在文件夹；删除后点击“刷新曲库”"
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
                    Button { text: "离线转写"; enabled: selectedIndex >= 0; onClicked: transcriptionDialog.open() }
                    Button { text: floatingLyrics.visible ? "关闭浮窗" : "歌词浮窗"; onClicked: floatingLyrics.visible = !floatingLyrics.visible }
                    Button {
                        visible: floatingLyrics.visible
                        text: desktopSettings.lyricsOverlayLocked ? "解锁浮窗" : "锁定浮窗"
                        onClicked: desktopSettings.lyricsOverlayLocked = !desktopSettings.lyricsOverlayLocked
                        ToolTip.visible: hovered
                        ToolTip.text: "锁定后浮窗可点击穿透；从这里解锁"
                    }
                    Button {
                        visible: floatingLyrics.visible
                        text: "浮窗归位"
                        onClicked: {
                            floatingLyrics.x = window.x + (window.width - floatingLyrics.width) / 2
                            floatingLyrics.y = window.y + window.height - floatingLyrics.height - 150
                        }
                    }
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

            Image {
                anchors.top: parent.top
                anchors.bottom: parent.bottom
                anchors.left: parent.left
                width: 146
                source: themeManager.coverUrl
                fillMode: Image.PreserveAspectCrop
                cache: false
                opacity: 0.16
            }

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
                    Slider { Layout.preferredWidth: 130; from: 0; to: 1; value: desktopSettings.volume; onMoved: desktopSettings.volume = value }
                }
            }
        }
    }
}
