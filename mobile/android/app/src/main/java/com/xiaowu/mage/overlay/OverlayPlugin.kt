package com.xiaowu.mage.overlay

import android.content.Context
import android.content.Intent
import android.os.Build
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * T06 悬浮 Capacitor 插件（三态：ball / pet / mini；与 secure-store 的
 * KeystorePlugin 同注册模式）：show/hide/setForm/expandMini/setPosition/isShown
 * + onEvent JS 事件桥（tap/doubletap/longpress/snapped/mini/closed/shown）。
 * 事件回调保留 call 为长连接（notifyOfRetain 由 saveCall 维持）。
 */
@CapacitorPlugin(name = "OverlayPlugin")
class OverlayPlugin : Plugin() {

    private var eventCallId: String? = null

    override fun load() {
        // 服务侧事件 → JS（运行期唯一出口）
        OverlayService.eventSink = { type, data ->
            val callId = eventCallId ?: return@eventSink
            val call = getSavedCall(callId) ?: return@eventSink
            val ret = JSObject()
            ret.put("type", type)
            val payload = JSObject()
            for ((k, v) in data) payload.put(k, v)
            ret.put("data", payload)
            notifyListeners(type, ret, true)
            call.resolve(ret)
            freeSavedCall(callId)
            eventCallId = null // 一次性 resolve，JS 侧循环 re-subscribe
        }
    }

    /** 显示悬浮（form: ball|pet；x/y/size 像素/dp；先校验权限） */
    @PluginMethod
    fun show(call: PluginCall) {
        val ctx = context ?: return call.reject("no-context")
        if (!FloatPermission.canDrawOverlays(ctx)) {
            return call.reject("需要悬浮窗权限", "NO_OVERLAY_PERMISSION")
        }
        val form = call.getString("form") ?: "ball"
        val x = call.getInt("x") ?: 100
        val y = call.getInt("y") ?: 200
        val size = call.getInt("size") ?: 120
        val i = Intent(ctx, OverlayService::class.java)
            .putExtra(OverlayService.EXTRA_FORM, form)
            .putExtra(OverlayService.EXTRA_X, x)
            .putExtra(OverlayService.EXTRA_Y, y)
            .putExtra(OverlayService.EXTRA_SIZE, size)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ctx.startForegroundService(i)
        } else {
            ctx.startService(i)
        }
        val r = JSObject()
        r.put("shown", true)
        call.resolve(r)
    }

    /** 隐藏并停服务（通知同消，Q13） */
    @PluginMethod
    fun hide(call: PluginCall) {
        OverlayService.instance?.hide()
        val r = JSObject()
        r.put("shown", false)
        call.resolve(r)
    }

    /** 双形态一键互切（ball ⇄ pet）；服务未运行时记住形态不 reject（否则 JS 端 setForm 抛异常、UI 状态不更新） */
    @PluginMethod
    fun setForm(call: PluginCall) {
        val form = call.getString("form") ?: return call.reject("missing form")
        if (form != "ball" && form != "pet") return call.reject("form must be ball|pet")
        val svc = OverlayService.instance
        if (svc != null) {
            svc.setForm(form)
        } else {
            // 服务未运行：持久化形态，下次 show 自动生效（OverlayService.onStartCommand 读 prefs）
            val ctx = context
            if (ctx != null) {
                ctx.getSharedPreferences(OverlayService.PREFS, Context.MODE_PRIVATE)
                    .edit().putString("form", form).apply()
            }
        }
        val r = JSObject()
        r.put("form", form)
        r.put("shown", svc != null)
        call.resolve(r)
    }

    /** 贴图推送（WebView 3D 帧快照 base64 → GL 面；球形裁剪由 form 决定） */
    @PluginMethod
    fun setTexture(call: PluginCall) {
        val b64 = call.getString("b64") ?: return call.reject("missing b64")
        OverlayService.instance?.setTextureB64(b64)
        call.resolve()
    }

    /** 球点开 = 迷你对话/语音窗（FR-303）：事件推 JS 渲染迷你层 */
    @PluginMethod
    fun expandMini(call: PluginCall) {
        OverlayService.instance?.expandMini()
        val r = JSObject()
        r.put("expanded", true)
        call.resolve(r)
    }

    @PluginMethod
    fun setPosition(call: PluginCall) {
        val x = call.getInt("x") ?: return call.reject("missing x")
        val y = call.getInt("y") ?: return call.reject("missing y")
        OverlayService.instance?.setPosition(x, y)
        val r = JSObject()
        r.put("x", x)
        r.put("y", y)
        call.resolve(r)
    }

    @PluginMethod
    fun isShown(call: PluginCall) {
        val r = JSObject()
        r.put("shown", OverlayService.instance != null)
        call.resolve(r)
    }

    /** 口型推送（TTS 20Hz 链路，Q8 悬浮口型数据源） */
    @PluginMethod
    fun setMouth(call: PluginCall) {
        val open = (call.getFloat("open") ?: 0f).coerceIn(0f, 1f)
        OverlayService.instance?.setMouth(open)
        call.resolve()
    }

    @PluginMethod
    fun playClip(call: PluginCall) {
        val name = call.getString("name") ?: "idle"
        OverlayService.instance?.playClip(name)
        call.resolve()
    }

    /** 性能档位（perf-tier 推入：30/24/8）+ 互斥活跃（主前台 pause/resume） */
    @PluginMethod
    fun setFps(call: PluginCall) {
        val n = call.getInt("fps") ?: 30
        OverlayService.instance?.setFps(n)
        call.resolve()
    }

    @PluginMethod
    fun pauseAnim(call: PluginCall) {
        OverlayService.instance?.pauseAnim()
        call.resolve()
    }

    @PluginMethod
    fun resumeAnim(call: PluginCall) {
        OverlayService.instance?.resumeAnim()
        call.resolve()
    }

    /** 权限查询/跳转（FloatPermission） */
    @PluginMethod
    fun permissionState(call: PluginCall) {
        val ctx = context ?: return call.reject("no-context")
        val r = JSObject()
        r.put("overlay", FloatPermission.canDrawOverlays(ctx))
        r.put("battery", FloatPermission.isIgnoringBatteryOptimizations(ctx))
        call.resolve(r)
    }

    @PluginMethod
    fun requestOverlayPermission(call: PluginCall) {
        val act = activity ?: return call.reject("no-activity")
        FloatPermission.requestOverlay(act)
        call.resolve()
    }

    @PluginMethod
    fun requestBatteryIgnore(call: PluginCall) {
        val act = activity ?: return call.reject("no-activity")
        FloatPermission.requestIgnoreBatteryOpt(act)
        call.resolve()
    }

    /** 事件订阅（tap/longpress/mini…）：保留 call 一次性 resolve，JS 侧循环重订 */
    @PluginMethod(returnType = PluginMethod.RETURN_CALLBACK)
    fun onEvent(call: PluginCall) {
        eventCallId?.let { freeSavedCall(it) }
        eventCallId = saveCall(call)
    }
}
