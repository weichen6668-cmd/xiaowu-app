package com.xiaowu.mage.overlay

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.os.Build
import android.os.IBinder
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import kotlin.math.abs

/**
 * T06 悬浮保活前台服务（Q13/FR-301~303）：
 * - 静默低优先级通知（渠道 overlay_silent）保活；关闭悬浮 = stopSelf = 通知消失
 * - 悬浮球/桌宠双形态 WindowManager 视图；拖动吸附边缘；点按/双击/长按手势分发 JS
 * - onStartCommand START_STICKY 被杀重启（系统重建）；重建后按持久化形态/位置还原
 * 仅 Android（TYPE_APPLICATION_OVERLAY）；iOS 无此服务。
 */
class OverlayService : Service() {

    companion object {
        const val CHANNEL_ID = "overlay_silent"
        const val NOTIF_ID = 0x0f10
        const val PREFS = "xw_overlay"
        const val EXTRA_FORM = "form"
        const val EXTRA_X = "x"
        const val EXTRA_Y = "y"
        const val EXTRA_SIZE = "size"

        /** JS 事件出口（OverlayPlugin 注册；线程安全由桥自身保证） */
        @Volatile
        var eventSink: ((String, Map<String, Any?>) -> Unit)? = null

        @Volatile
        var instance: OverlayService? = null

        private fun emit(type: String, data: Map<String, Any?> = emptyMap()) {
            try {
                eventSink?.invoke(type, data)
            } catch (e: Exception) {
                /* 桥已断开：吞掉，悬浮本地交互不受影响 */
            }
        }
    }

    private lateinit var wm: WindowManager
    private var container: FrameLayout? = null
    private var petView: PetRendererView? = null
    private var params: WindowManager.LayoutParams? = null
    private var form = "ball"
    private var sizeDp = 120
    private var lastTapMs = 0L
    private var downX = 0f
    private var downY = 0f
    private var startX = 0
    private var startY = 0
    private var dragging = false
    private var longPressRunnable: Runnable? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        instance = this
        wm = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        createChannel()
        startForeground(NOTIF_ID, buildNotification())
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        form = intent?.getStringExtra(EXTRA_FORM) ?: prefs.getString("form", "ball") ?: "ball"
        sizeDp = intent?.getIntExtra(EXTRA_SIZE, 0)?.takeIf { it > 0 }
            ?: prefs.getInt("size", 120)
        val x = intent?.getIntExtra(EXTRA_X, Int.MIN_VALUE) ?: Int.MIN_VALUE
        val y = intent?.getIntExtra(EXTRA_Y, Int.MIN_VALUE) ?: Int.MIN_VALUE
        showInternal(
            form,
            if (x == Int.MIN_VALUE) prefs.getInt("x", 100) else x,
            if (y == Int.MIN_VALUE) prefs.getInt("y", 200) else y,
            sizeDp,
        )
        // START_STICKY：被杀后系统重建，重建走上述持久化还原（Q13 保活链路）
        return START_STICKY
    }

    override fun onDestroy() {
        try {
            container?.let { wm.removeView(it) }
        } catch (e: Exception) {
            /* 已移除：吞掉 */
        }
        container = null
        petView = null
        instance = null
        emit("closed")
        super.onDestroy()
    }

    /* ============ 对外形态控制（OverlayPlugin 调入） ============ */

    fun show(form: String, x: Int, y: Int, sizeDp: Int) {
        showInternal(form, x, y, sizeDp)
    }

    fun hide() {
        stopSelf()
    }

    fun setForm(newForm: String) {
        val p = params ?: return
        showInternal(newForm, p.x, p.y, sizeDp)
    }

    /** 贴图推送（WebView 3D 帧快照 → GL 面；Q14 近似渲染） */
    fun setTextureB64(b64: String) {
        petView?.setTextureB64(b64)
    }

    fun setPosition(x: Int, y: Int) {
        val p = params ?: return
        p.x = x
        p.y = y
        try {
            wm.updateViewLayout(container, p)
            persist(x, y)
        } catch (e: Exception) {
            /* 视图已detach：吞掉 */
        }
    }

    fun expandMini() {
        emit("mini", mapOf("form" to form))
    }

    fun setMouth(open: Float) {
        petView?.setMouth(open)
    }

    fun playClip(name: String) {
        petView?.playClip(name)
    }

    fun setFps(n: Int) {
        petView?.setFps(n)
    }

    fun pauseAnim() {
        petView?.pauseAnim()
    }

    fun resumeAnim() {
        petView?.resumeAnim()
    }

    /* ============ 内部实现 ============ */

    private fun showInternal(newForm: String, x: Int, y: Int, size: Int) {
        form = if (newForm == "pet") "pet" else "ball"
        sizeDp = size.coerceIn(80, 200) // FR-302：80~200dp
        val scale = resources.displayMetrics.density
        val px = (sizeDp * scale).toInt()

        val p = params ?: WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            else
                @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT,
        ).also {
            it.gravity = Gravity.TOP or Gravity.START
            it.x = x
            it.y = y
        }
        params = p

        val v = buildView(px)
        container = v.first
        petView = v.second
        try {
            if (container?.parent != null) wm.removeView(container)
        } catch (e: Exception) {
            /* ignore */
        }
        wm.addView(container, p)
        persist(p.x, p.y)
        emit("shown", mapOf("form" to form, "x" to p.x, "y" to p.y, "size" to sizeDp))
    }

    /** 构建悬浮视图：ball=简化圆贴图容器（截帧/静态）；pet=独立 GL 渲染面 */
    @SuppressLint("ClickableViewAccessibility")
    private fun buildView(px: Int): Pair<FrameLayout, PetRendererView?> {
        val frame = FrameLayout(this)
        val pet = PetRendererView(this)
        pet.layoutParams = FrameLayout.LayoutParams(px, px)
        frame.addView(pet)

        // 手势：拖动吸附 + 点按/双击/长按（FR-301/303）
        frame.setOnTouchListener { v, ev ->
            when (ev.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    downX = ev.rawX
                    downY = ev.rawY
                    val lp = params ?: return@setOnTouchListener true
                    startX = lp.x
                    startY = lp.y
                    dragging = false
                    val lr = Runnable {
                        dragging = true // 长按后不再触发 click
                        emit("longpress", mapOf("form" to form))
                    }
                    longPressRunnable = lr
                    v.postDelayed(lr, 550)
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = (ev.rawX - downX).toInt()
                    val dy = (ev.rawY - downY).toInt()
                    if (!dragging && (abs(dx) > 12 || abs(dy) > 12)) {
                        dragging = true
                        longPressRunnable?.let { v.removeCallbacks(it) }
                    }
                    if (dragging) setPosition(startX + dx, startY + dy)
                    true
                }
                MotionEvent.ACTION_UP -> {
                    longPressRunnable?.let { v.removeCallbacks(it) }
                    if (dragging) {
                        snapToEdge(ev.rawX, ev.rawY)
                    } else {
                        val now = System.currentTimeMillis()
                        if (now - lastTapMs < 280) {
                            emit("doubletap", mapOf("form" to form))
                            lastTapMs = 0
                        } else {
                            lastTapMs = now
                            v.postDelayed({
                                if (lastTapMs == now) emit("tap", mapOf("form" to form))
                            }, 290)
                        }
                    }
                    dragging = false
                    true
                }
                MotionEvent.ACTION_CANCEL -> {
                    longPressRunnable?.let { v.removeCallbacks(it) }
                    dragging = false
                    true
                }
                else -> false
            }
        }
        // ball 形态暂停 GL 动画（静态贴图，Q12 互斥活跃）+ 圆形裁剪；pet 恢复全矩形面
        pet.setBallMask(form == "ball")
        if (form == "ball") pet.pauseAnim() else pet.resumeAnim()
        return Pair(frame, pet) // 双形态共用 GL 面：球=圆形裁剪静态，桌宠=矩形动画
    }

    /** 拖动松手吸附最近屏幕边缘（FR-301） */
    private fun snapToEdge(rawX: Float, rawY: Float) {
        val p = params ?: return
        val dm = resources.displayMetrics
        val cx = rawX
        val left = cx < dm.widthPixels / 2f
        p.x = if (left) 0 else dm.widthPixels - (sizeDp * dm.density).toInt()
        p.y = p.y.coerceIn(0, dm.heightPixels - (sizeDp * dm.density).toInt())
        try {
            wm.updateViewLayout(container, p)
            persist(p.x, p.y)
        } catch (e: Exception) {
            /* ignore */
        }
        emit("snapped", mapOf("side" to if (left) "left" else "right", "x" to p.x, "y" to p.y))
    }

    private fun persist(x: Int, y: Int) {
        getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putInt("x", x).putInt("y", y)
            .putString("form", form).putInt("size", sizeDp)
            .apply()
    }

    /* ============ 通知（Q13：静默低优先级） ============ */

    private fun createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = NotificationChannel(
                CHANNEL_ID,
                "悬浮保活",
                NotificationManager.IMPORTANCE_MIN, // 静默低优先级
            )
            ch.setSound(null, null)
            ch.enableVibration(false)
            ch.setShowBadge(false)
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.createNotificationChannel(ch)
        }
    }

    private fun buildNotification(): Notification {
        val open = packageManager.getLaunchIntentForPackage(packageName)
        val pi = PendingIntent.getActivity(
            this, 0, open,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val b = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            Notification.Builder(this, CHANNEL_ID)
        else
            @Suppress("DEPRECATION") Notification.Builder(this)
        return b
            .setContentTitle("小巫桌宠运行中")
            .setContentText("关闭悬浮可在设置中停用")
            .setSmallIcon(android.R.drawable.presence_online)
            .setContentIntent(pi)
            .setOngoing(true)
            .setPriority(Notification.PRIORITY_MIN)
            .setCategory(Notification.CATEGORY_SERVICE)
            .setColor(Color.rgb(88, 64, 160))
            .build()
    }
}
