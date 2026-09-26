package com.xiaowu.mage.overlay

import android.content.Context
import android.content.Intent
import android.os.Build
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "OverlayPlugin")
class OverlayPlugin : Plugin() {

    private var eventCall: PluginCall? = null

    override fun load() {
        OverlayService.eventSink = { type, data ->
            val call = eventCall ?: return
            val ret = JSObject()
            ret.put("type", type)
            val payload = JSObject()
            for ((k, v) in data) payload.put(k, v)
            ret.put("data", payload)
            notifyListeners(type, ret, true)
            call.resolve(ret)
            eventCall = null
        }
    }

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

    @PluginMethod
    fun hide(call: PluginCall) {
        OverlayService.instance?.hide()
        val r = JSObject()
        r.put("shown", false)
        call.resolve(r)
    }

    @PluginMethod
    fun setForm(call: PluginCall) {
        val form = call.getString("form") ?: return call.reject("missing form")
        val svc = OverlayService.instance ?: return call.reject("overlay not shown")
        if (form != "ball" && form != "pet") return call.reject("form must be ball|pet")
        svc.setForm(form)
        val r = JSObject()
        r.put("form", form)
        call.resolve(r)
    }

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

    @PluginMethod
    fun onEvent(call: PluginCall) {
        eventCall = call
    }
}
