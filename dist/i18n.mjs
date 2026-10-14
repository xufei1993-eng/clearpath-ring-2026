// The language is explicit per page session; changing it starts a new session.
export const language = new URLSearchParams(globalThis.location?.search || '').get('lang') === 'en' ? 'en' : 'zh-CN';
export const english = language === 'en';

const messages = new Map([
  ['ClearPath · 门前通行助手', 'ClearPath · Doorway assistant'],
  ['ClearPath 门前通行助手。用本地视觉标记疑似障碍，通过人工确认与后续画面复查。', 'ClearPath doorway assistant. Local visual comparison, human confirmation, and a later-frame recheck.'],
  ['跳至主要内容', 'Skip to main content'], ['ClearPath 首页', 'ClearPath home'],
  ['为每一次出门留出空间', 'Make room for every journey'], ['主导航', 'Main navigation'],
  ['通行检查', 'Path check'], ['实拍评测', 'Footage evaluation'], ['使用说明', 'How it works'],
  ['本地处理 · 无模型费用', 'Local processing · No model fees'],
  ['门前的路，留给你。', 'Make room for your next step.'],
  ['关注通行区域里的变化，帮你发现和处理疑似障碍。', 'Notice changes in your path. Review them, take action, and check again.'],
  ['体验完整闭环', 'Try the complete flow'], ['门前画面', 'Doorway view'],
  ['合成样例 · 非 Ring 画面', 'Synthetic sample · Not Ring footage'],
  ['设备摄像头 · 本地实拍', 'Device camera · Local footage'],
  ['用户选择的本地素材 · 非 Ring 画面', 'User-provided local footage · Not Ring'],
  ['用户声明的自录测试素材 · 非 Ring 画面', 'Self-recorded test footage · User declared · Not Ring'],
  ['Ring Playground · 官方模拟视频', 'Ring Playground · Official simulated footage'],
  ['尚未检查', 'Not checked yet'], ['画面来源', 'Footage source'],
  ['体验样例', 'Sample'], ['我的摄像头', 'Camera'], ['本地素材', 'Local footage'],
  ['标定通行区域：点选四个角，或使用下方预设区域按钮', 'Mark the path: select four corners, or use the preset region below'],
  ['待建立参考', 'Reference needed'], ['虚线区域 = 希望保持畅通的区域', 'Dashed outline = path to keep clear'],
  ['显示最新画面', 'Show latest frame'], ['全屏查看画面', 'View footage full screen'],
  ['切换样例', 'Sample scene'], ['空通道', 'Empty path'], ['区域内放箱子', 'Box inside path'], ['区域外放箱子', 'Box outside path'],
  ['开启摄像头', 'Start camera'], ['画面在设备上处理，不会上传。', 'Processed on this device. No footage upload.'],
  ['选择视频 / 图片', 'Choose video / image'], ['播放 / 暂停', 'Play / pause'],
  ['固定同一机位，先选择空通道素材。', 'Use one fixed camera. Start with an empty-path frame.'],
  ['已选择本地素材（录屏时隐藏文件名）', 'Local footage selected (filename hidden)'],
  ['视频位置', 'Video position'], ['定位秒数', 'Go to second'], ['定位', 'Go'],
  ['我拍摄的测试素材', 'I recorded this test footage'],
  ['此声明仅标注素材来源，不改变检测结果。', 'This declares the source; it does not change the result.'],
  ['Playground 短时 access token', 'Short-lived Playground access token'],
  ['仅保存在本地服务内存', 'Kept only in local server memory'], ['连接', 'Connect'], ['设备', 'Device'],
  ['先连接账号', 'Connect an account first'], ['打开直播', 'Start live view'], ['断开', 'Disconnect'],
  ['尚未验证 Ring 连接。需要本地服务与 Playground 账号。', 'Ring is not connected. A local server and Playground account are required.'],
  ['官方开发者入口 ↗', 'Official developer portal ↗'],
  ['你的通行区域', 'Your path region'],
  ['先标出你希望保持畅通的区域，再保存一帧空通道作为参考。', 'Mark the path you want to keep clear, then save an empty-path reference.'],
  ['点选四角', 'Select four corners'], ['使用预设区域', 'Use preset region'], ['保存空通道参考', 'Save empty-path reference'],
  ['用数值标定四角（键盘可用）', 'Set four corners numerically (keyboard accessible)'],
  ['按顺时针或逆时针填写四角。X 从左到右、Y 从上到下，均为 0 到 1。应用后须重新保存参考。', 'Enter the corners in clockwise or counterclockwise order. X runs left to right and Y top to bottom, from 0 to 1. Applying a region requires a new reference.'],
  ['应用通行区域', 'Apply path region'],
  ['请填写全部八个坐标，数值须在 0 到 1 之间。', 'Enter all eight coordinates as numbers from 0 to 1.'],
  ['区域无效，请沿边缘顺序填写四角，避免交叉或重合。', 'Invalid region. Enter the corners in boundary order without crossings or duplicate points.'],
  ['数值区域已应用。请确认当前通道为空，再保存新的参考帧。', 'Numeric region applied. Confirm the path is empty, then save a new reference frame.'],
  ['数值区域已应用。旧参考已清除，请重新保存空通道参考。', 'Numeric region applied. The old reference was cleared. Save the empty path again.'],
  ['通行区域', 'Path region'], ['疑似新增障碍', 'Possible obstacle'], ['参考帧：未保存', 'Reference: not saved'],
  ['先认识你的通道', 'Start with your path'],
  ['保存空通道参考后，ClearPath 才能比较后续画面的变化。', 'Save an empty-path reference so ClearPath can compare later frames.'],
  ['通行区域内的变化像素占比', 'Changed pixels within the path'], ['不代表实际被占宽度', 'Not a physical width measurement'],
  ['检查流程', 'Check workflow'], ['建立参考', 'Save a reference'], ['标定区域，保存空通道', 'Mark the path and save it empty'],
  ['发现变化', 'Detect a change'], ['比较当前画面与参考帧', 'Compare this frame with the reference'],
  ['人工确认', 'Human confirmation'], ['确认疑似障碍是否挡路', 'Decide whether it blocks your path'],
  ['移走后复查', 'Move it and recheck'], ['使用后续画面再次检查', 'Check a later frame'],
  ['检查当前画面', 'Check current frame'], ['确认存在障碍', 'Confirm obstruction'], ['不是障碍', 'Not an obstruction'],
  ['使用后续画面复查', 'Recheck a later frame'], ['朗读当前提示', 'Read this guidance aloud'], ['每 3 秒检查一次', 'Check every 3 seconds'],
  ['辅助判断，保留你的决定。', 'Assistance that keeps you in control.'],
  ['画面可能受光线、遮挡和机位变化影响。当前结果不代表通行安全，也不测量实际宽度。', 'Lighting, occlusion, and camera movement can affect results. This is not a safety assessment or a width measurement.'],
  ['每一步，都有依据。', 'A record of every step.'],
  ['记录保存在本次页面会话中，导出后可用于复盘。', 'Records stay in this page session. Export them for review.'],
  ['导出检查记录 ↓', 'Export check records ↓'], ['还没有检查记录。先保存一帧空通道参考。', 'No records yet. Save an empty-path reference first.'],
  ['ClearPath · 给每一次出门多一份从容', 'ClearPath · A little more confidence at the door'],
  ['零付费 API · 无云端视频存储', 'No paid APIs · No cloud video storage'],
  ['从一段空通道开始', 'Start with an empty path'], ['关闭使用说明', 'Close instructions'], ['关闭 ×', 'Close ×'],
  ['固定摄像机，确保门前地面清晰可见。', 'Fix the camera in place and keep the floor in clear view.'],
  ['点选画面的四个角，或使用预设区域。此区域仅表示你希望保持畅通的位置。', 'Select four corners or use the preset. This region marks the area you want to keep clear.'],
  ['确认通道为空，保存参考。放置物品后检查新画面，查看变化位置。', 'Confirm the path is empty and save a reference. After placing an item, check a new frame and review the marked change.'],
  ['人工确认后移走物品，用后续画面复查。系统不会发送消息给他人。', 'Confirm the obstruction, move the item, then recheck a later frame. The app does not send messages to other people.'],
  ['“体验样例”由程序绘制，用于理解流程，不是实拍评测。Ring 接入使用本人 Playground 账号；真实联调请从本机服务打开。图片模式可连续选择同一机位的前后照片；视频模式可暂停保存参考，再播放到后续时刻检查。', 'The sample is drawn by code to explain the workflow; it is not real-footage validation. Ring uses your Playground account through the local server. For images, import successive photos from the same camera. For video, pause to save a reference, then move to a later time.'],
  ['基础比较在浏览器进行；可选增强配准在本机 Python 服务处理，画面不发往云端。参考图与检查记录只在本页内存中；刷新页面后清除。Ring token 仅进入本地服务内存，断开后移除。', 'Basic comparison runs in the browser. Optional registration runs in the local Python server; footage is not sent to the cloud. Reference frames and records stay in page memory and clear on reload. Ring tokens stay in local server memory and are removed on disconnect.'],
  ['录屏隐私模式', 'Presentation privacy'],
  ['隐藏凭据、设备名称和文件原名；保留真实来源、状态与捕获时间。', 'Hide credentials, device names, and filenames. Keep the real source, result, and capture time.'],
  ['切换语言会开始新的页面会话。', 'Changing language starts a new page session.'],
  ['录制工具', 'Recording tools'],
  ['临时显示连接设置', 'Show connection settings temporarily'], ['隐藏连接设置', 'Hide connection settings'],
  ['当前画面待检查', 'Current frame needs a check'], ['画面或处理条件已改变，请重新检查当前画面。', 'The frame or processing conditions changed. Check the current frame again.'],
  ['当前显示检查证据帧', 'Showing the captured evidence frame'],
  ['参考已保存', 'Reference saved'], ['发现疑似障碍', 'Possible obstruction'], ['人工已确认', 'Confirmed by a person'], ['人工已排除', 'Dismissed by a person'],
  ['后续画面复查', 'Later-frame recheck'], ['当前未见变化', 'No new change found'], ['暂无法判断', 'Unable to assess'], ['切换画面来源', 'Footage source changed'],
  ['当前未见新增障碍', 'No new obstacle found'], ['疑似障碍 · 待确认', 'Possible obstacle · Review needed'], ['已确认 · 待复查', 'Confirmed · Recheck needed'],
  ['请先打开摄像头、选择本地素材或连接 Ring 直播。', 'Start the camera, choose local footage, or connect a Ring stream first.'],
  ['请先完成四角标定，或使用预设区域。', 'Finish selecting four corners, or use the preset region.'],
  ['参考画面不适合检查，请调整后重试。', 'This reference cannot support a check. Adjust the view and try again.'],
  ['合成流程预演：以程序生成的空场景建立参考。', 'Synthetic walkthrough: a code-drawn empty scene was saved as the reference.'],
  ['用户将当前画面保存为空通道参考。', 'The user saved this frame as an empty-path reference.'],
  ['参考已准备好', 'Your reference is ready'], ['画面有变化时点击检查。保持机位固定，以便准确比较通行区域。', 'Check when the view changes. Keep the camera fixed for a useful path comparison.'],
  ['空通道参考已保存。现在可放置物品并检查后续画面。', 'Empty-path reference saved. Place an item, then check a later frame.'],
  ['正在本机处理当前证据帧，请稍候。', 'Processing this captured frame locally. Please wait.'],
  ['请先保存一帧空通道参考。', 'Save an empty-path reference first.'], ['请先完成区域标定。', 'Finish marking the region first.'],
  ['画面暂不可用', 'Footage is unavailable'], ['请恢复视频来源，再使用新画面检查。', 'Restore the video source, then check a new frame.'],
  ['等待新的视频帧', 'Waiting for a new video frame'], ['视频可能已暂停或中断。请恢复直播后再检查。', 'The stream may be paused or interrupted. Resume it before checking.'],
  ['这是刚才检查过的同一帧。请播放视频、切换样例或选择后续照片。', 'This frame was already checked. Play the video, switch the sample, or import a later photo.'],
  ['复查需要晚于人工确认的画面。倒回旧视频或重复同一帧不能完成复查。', 'Rechecking needs a frame later than the confirmed one. An earlier or repeated frame cannot complete the recheck.'],
  ['正在检查当前画面', 'Checking the current frame'], ['请稍候，结果将对应本次捕获的画面。', 'Please wait. The result will refer to this captured frame.'],
  ['无法确认本机处理版本，请刷新后重新检查。', 'The local processing version could not be verified. Reload and check again.'],
  ['本机配准版本已变化，请先导出并刷新后重新评测。', 'The local registration version changed. Export your records, then reload before checking again.'],
  ['本机处理超时', 'Local processing timed out'], ['本次检查未完成，请重试当前画面。', 'This check did not finish. Try the current frame again.'],
  ['本次检查没有返回有效结果，请重试。', 'This check did not return a valid result. Try again.'],
  ['处理版本已变化', 'Processing version changed'], ['本机处理未完成', 'Local processing did not finish'], ['请重试当前画面。', 'Try the current frame again.'],
  ['请结合证据画面人工核对。', 'Review the captured evidence yourself.'], ['仍有变化需要处理', 'A change still needs attention'],
  ['这里可能挡路了', 'This may block your path'], ['新画面待复查', 'A later frame needs rechecking'],
  ['当前画面未见明显新增障碍。请点击复查，完成这次处理记录。', 'No substantial new obstacle was found in this frame. Select recheck to complete this record.'],
  ['复查已完成', 'Recheck complete'], ['这帧后续画面与参考比较，未见明显新增障碍。', 'This later frame shows no substantial new obstacle compared with the reference. '],
  ['照片按用户导入顺序比较，拍摄先后未核实。', 'Photo order follows user imports; capture order is not verified.'],
  ['出门前仍请观察实际环境。', 'Still check the actual surroundings before leaving.'], ['先别急着下结论', 'The view needs a closer look'],
  ['画面来源已改变。请为当前机位重新保存空通道参考。', 'The footage source changed. Save a new empty-path reference for this camera.'],
  ['连接已断开，短时 token 已从本地服务内存移除。', 'Disconnected. The short-lived token was removed from local server memory.'],
  ['开启摄像头，开始本地检查', 'Start the camera for a local check'], ['选择同一机位的视频或前后照片', 'Choose video or successive photos from one camera'],
  ['连接官方 Playground 直播', 'Connect an official Playground stream'],
  ['用户确认标记区域存在通行障碍。', 'The user confirmed an obstruction in the marked path.'],
  ['已确认，等待处理', 'Confirmed. Time to take action.'], ['将物品挪出通行区域。完成后使用后续画面复查，当前记录会保持待处理。', 'Move the item out of the path, then recheck a later frame. This record stays open until then.'],
  ['接下来：切换到“空通道”，再点击“使用后续画面复查”。', 'Next: choose “Empty path”, then “Recheck a later frame”.'],
  ['用户将当前疑似变化标记为不是通行障碍。', 'The user marked this visual change as not obstructing the path.'],
  ['已记录你的判断', 'Your decision is recorded'], ['当前提示已由你排除。后续画面出现变化时，仍会重新提示。', 'You dismissed this alert. Changes in later frames can still trigger a new review.'],
  ['此浏览器暂不支持朗读。可使用屏幕阅读器读取状态文字。', 'Speech is unavailable in this browser. A screen reader can read the status text.'],
  ['正在调整通行区域。完成后请重新保存空通道参考。', 'Adjusting the path region. Save a new empty-path reference when finished.'],
  ['取消标定', 'Cancel marking'],
  ['沿通道边缘按顺时针或逆时针点选四角。也可聚焦画面，用方向键移动十字、Enter 确认，Esc 取消。', 'Select four corners around the path in order. Or focus the view, move the crosshair with arrow keys, press Enter to select, and Esc to cancel.'],
  ['已使用预设通行区域。请确认位置适合你的画面，再保存参考。', 'Preset region applied. Make sure it fits your view before saving a reference.'],
  ['预设区域已应用。', 'Preset region applied.'], ['区域已更新。确认画面为空通道后，重新保存参考。', 'Region updated. Confirm the path is empty, then save a new reference.'],
  ['区域已更新。确认空通道后，重新保存参考。', 'Region updated. Confirm the path is empty, then save a new reference.'],
  ['已标定四角，请保存空通道参考。', 'Four corners marked. Save an empty-path reference.'],
  ['摄像头需要浏览器支持与本地 localhost 或 HTTPS 地址。', 'The camera needs browser support and a localhost or HTTPS address.'],
  ['摄像头已关闭', 'Camera stopped'], ['请重新开启摄像头并使用新画面检查。', 'Restart the camera and check a new frame.'],
  ['摄像头已开启。先保存空通道参考。', 'Camera started. Save an empty-path reference first.'],
  ['摄像头权限未开启。请在浏览器允许访问，或使用本地视频。', 'Camera permission was denied. Allow camera access in your browser, or choose a local video.'],
  ['请选择浏览器支持的视频或图片。', 'Choose a video or image supported by this browser.'],
  ['新的素材已载入。请先找到空通道画面并保存参考。', 'New footage loaded. Find an empty-path frame and save a reference.'],
  ['图片无法解码，请尝试 JPEG 或 PNG。', 'This image could not be decoded. Try JPEG or PNG.'],
  ['后续照片已载入，可检查或复查。拍摄时间由用户核对。', 'Next photo loaded. You can check or recheck it; verify the capture order yourself.'],
  ['图片已载入，请保存空通道参考。', 'Image loaded. Save an empty-path reference.'],
  ['视频无法解码，请尝试 MP4 / H.264。', 'This video could not be decoded. Try MP4 / H.264.'],
  ['视频已载入。暂停在空通道画面并保存参考，再播放至后续时刻。', 'Video loaded. Pause on an empty path and save a reference, then move to a later time.'],
  ['视频正在跳转，请检查新的画面', 'Seeking video · Check the new frame'], ['视频当前画面 · 请重新检查', 'Current video frame · Check again'],
  ['请输入 Playground 生成的短时 access token。', 'Enter the short-lived access token generated by Playground.'],
  ['正在通过本地服务验证设备接口…', 'Verifying the device API through the local server…'],
  ['官方接口返回了空设备列表。请检查 Playground 是否已添加设备。', 'The official API returned no devices. Check that a device is added in Playground.'],
  ['正在协商官方 WHEP 视频流…', 'Negotiating the official WHEP video stream…'], ['Ring 直播已结束', 'Ring live view ended'],
  ['重新打开直播后再检查。冻结的旧画面不能完成复查。', 'Restart live view before checking. A frozen old frame cannot complete a recheck.'],
  ['已收到可解码的 Ring Playground 视频帧。请保留官方水印；直播有时限，结束后需重新打开。', 'A decodable Ring Playground video frame has arrived. Keep the official watermark. Streams expire; restart live view after it ends.'],
  ['实际收到 Ring Playground 视频帧；尚未进行通行状态验证。', 'A Ring Playground video frame was received. The path has not been checked yet.'],
  ['尚未取得 Ring 画面', 'Ring footage has not arrived'], ['请查看连接错误并重试。合成样例不能替代真实 Ring 验证。', 'Review the connection error and try again. Synthetic samples do not validate a Ring connection.'],
  ['已断开，token 已从本地服务内存移除。', 'Disconnected. The token was removed from local server memory.'],
  ['Ring 已断开。重新连接后需重新保存参考。', 'Ring disconnected. Save a new reference after reconnecting.'],
  ['这是合成样例。核对标记后点击“确认存在障碍”，再切回空通道复查。', 'This is a synthetic sample. Review the marking, confirm the obstruction, then choose Empty path and recheck.'],
  ['暂无记录，请先保存空通道参考。', 'No records yet. Save an empty-path reference first.'],
  ['辅助参考比较，不代表通行安全；synthetic_sample 为合成演示，不能用于真实效果评测。', 'Reference comparison assistance, not a safety assessment. synthetic_sample is a drawn demonstration, not real-footage validation.'],
  ['浏览器暂不支持全屏查看。', 'Full screen is unavailable in this browser.'], ['最新画面 · 请重新检查', 'Latest frame · Check again'],
  ['未发现明显新增变化；请结合画面人工确认。', 'No substantial new visual change found. Review the actual view yourself.'],
  ['标定区域出现疑似新增障碍，请查看证据并人工确认。', 'A new visual change overlaps the marked path. Review the evidence and confirm it yourself.'],
  ['参考画面无效，请重新采集清空后的通道。', 'The reference is invalid. Capture the empty path again.'],
  ['当前画面无效或尺寸不一致，请重新采集。', 'The current frame is invalid or its dimensions differ. Capture it again.'],
  ['通道区域无效，请按边缘顺序重新标定。', 'The path region is invalid. Select its corners in order.'],
  ['通道区域过小，当前分辨率不足以判断。', 'The path region is too small to assess at this resolution.'],
  ['画面过暗，暂时无法可靠比较。', 'The view is too dark for a reliable comparison.'],
  ['画面严重过曝，暂时无法可靠比较。', 'The view is overexposed and cannot be compared reliably.'],
  ['画面包含缺失像素，请重新采集。', 'Some frame pixels are missing. Capture it again.'],
  ['整体曝光变化较大，请等待光线稳定后复查。', 'Exposure changed substantially. Wait for stable lighting and check again.'],
  ['疑似镜头移动，请重新标定并采集参考画面。', 'The camera may have moved. Mark the path again and save a new reference.'],
  ['画面变化过大，无法区分新增障碍和场景变化。', 'The scene changed too much to distinguish an obstacle from background changes.'],
  ['检测到暗影或深色物体，无法区分，请人工确认。', 'A shadow or dark object was detected. The app cannot distinguish them; review the view yourself.'],
  ['关注区域有部分离开当前画面，不能确认整区状态。请保留足够取景余量并重新标定。', 'Part of the path is outside the current frame, so the whole region cannot be assessed. Leave more space around it and mark it again.'],
  ['本机配准超时，本次不能确认区域状态。', 'Local registration timed out. The path cannot be assessed in this check.'],
  ['当前参考比较未见明显新增障碍。', 'No substantial new obstacle found in this reference comparison.'],
  ['通行区域出现了新增变化，请核对标记位置。', 'A new change overlaps the path. Review the marked location.'],
  ['光线变化过大，请稳定照明后重试。', 'Lighting changed too much. Try again under stable lighting.'],
  ['疑似机位发生变化，请固定摄像机并重新保存参考。', 'The camera may have moved. Fix it in place and save a new reference.'],
  ['画面变化较大，无法可靠区分障碍与场景变化。', 'Scene changes are too large to distinguish an obstacle reliably.'],
  ['参考画面无效，请重新保存空通道参考。', 'The reference is invalid. Save the empty path again.'],
  ['通行区域无效，请按顺序标定四个角。', 'The path region is invalid. Select four corners in order.'],
  ['通行区域太小，请扩大到完整通道。', 'The region is too small. Include the full path.'],
  ['当前页面是静态预览。请在电脑运行 python3 server.py，再打开本地地址连接 Ring。', 'This is a static preview. Run python3 server.py on your computer, then open the local address to connect Ring.'],
  ['Ring 接入只在本地服务启用。请运行 python3 server.py 并打开 http://127.0.0.1:8765。', 'Ring connections use the local server. Run python3 server.py and open http://127.0.0.1:8765.'],
  ['Ring 直播已结束。请重新打开直播。', 'Ring live view ended. Start it again.'],
  ['Ring 直播已结束。请重新打开直播；结束前的画面不能作为新复查证据。', 'Ring live view ended. Restart it; old frames cannot serve as new recheck evidence.'],
  ['ICE 协商超时，请检查网络后重试。', 'ICE negotiation timed out. Check the network and try again.'],
  ['本地服务返回了不支持的会话地址。', 'The local server returned an unsupported session address.'],
  ['已完成 Ring 协商，但未收到可解码的视频帧。', 'Ring negotiation completed, but no decodable video frame arrived.'],
  ['本机配准分析尺寸不符合约定。', 'The local registration image dimensions do not match the protocol.'],
  ['本机配准画面无法读取。', 'The local registration image could not be read.'],
  ['本机配准画面读取超时。', 'Reading the local registration image timed out.'],
  ['本机配准坐标无效。', 'The local registration coordinates are invalid.'],
  ['画面来源已切换', 'The footage source changed'],
]);

const fragments = [
  [' 复查尚未完成。', ' The recheck is still open.'],
  [' 是否影响通行，由你确认。', ' You decide whether it blocks the path.'],
  [' 仅表示当前参考比较结果。', ' This describes only the current reference comparison.'],
  ['参考帧：', 'Reference: '], ['检查帧 ', 'Captured '],
];
const phrases = [...messages, ...fragments].sort((a, b) => b[0].length - a[0].length);

export function tr(value) {
  const text = String(value ?? '');
  if (!english) return text;
  if (!/[\u3400-\u9fff]/.test(text)) return text;
  if (messages.has(text.trim())) return text.replace(text.trim(), messages.get(text.trim()));
  if (/^角 [1-4]( [XY])?$/.test(text.trim())) return text.replace('角 ', 'Corner ');
  if (/^已验证官方设备接口，找到 \d+ 个设备。/.test(text)) {
    const n = text.match(/找到 (\d+)/)[1];
    return `Official device API verified. ${n} device${n === '1' ? '' : 's'} found. Choose a device and start live view; a video frame must arrive before the connection is complete.`;
  }
  if (/^本地服务返回 \d+$/.test(text)) return `Local server returned ${text.match(/\d+$/)[0]}`;
  if (/^\d+(\.\d+)? 秒$/.test(text)) return `${text.split(' ')[0]} seconds`;
  if (text.endsWith('的证据画面')) return `Evidence frame: ${tr(text.slice(0, -5))}`;
  // Compose only known phrases, retaining dates, percentages, and error details.
  let translated = text;
  for (const [zh, en] of phrases) {
    if (translated.includes(zh)) translated = translated.split(zh).join(en);
  }
  return translated;
}

export function formatTime(value) {
  return new Date(value).toLocaleTimeString(english ? 'en-GB' : 'zh-CN', {hour12:false});
}

export function translateDOM(root = document) {
  if (!english) return;
  if (root.nodeType === 1 && root.hasAttribute('data-i18n-skip')) return;
  if (root.nodeType === 3 && root.parentElement?.closest('[data-i18n-skip]')) return;
  if (root.nodeType === 3) { const next = tr(root.data); if (next !== root.data) root.data = next; return; }
  if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
  if (root.nodeType === 1) {
    if (['SCRIPT', 'STYLE'].includes(root.tagName)) return;
    for (const name of ['aria-label', 'aria-valuetext', 'placeholder', 'title', 'alt', 'content']) {
      if (root.hasAttribute(name)) { const before=root.getAttribute(name), after=tr(before); if(after!==before)root.setAttribute(name,after); }
    }
  }
  for (const child of root.childNodes) translateDOM(child);
}

export function initializeI18n() {
  document.documentElement.lang = language;
  translateDOM();
  if (!english) return;
  // Also translate text added by state changes, without replacing DOM elements,
  // event listeners, geometry, result values, or source metadata.
  new MutationObserver(changes => {
    for (const change of changes) {
      if (change.type === 'childList') for (const child of change.addedNodes) translateDOM(child);
      else translateDOM(change.target);
    }
  }).observe(document.body, {subtree:true, childList:true, characterData:true, attributes:true, attributeFilter:['aria-label','aria-valuetext','placeholder','title','alt']});
}
