package com.xiaowu.mage.overlay

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings

/**
 * T06 悬浮窗权限 + 电池白名单（FR-306/Q13）。
 * - canDrawOverlays：SYSTEM_ALERT_WINDOW（TYPE_APPLICATION_OVERLAY 前置）
 * - requestOverlay：跳系统「显示在其他应用上层」设置页
 * - isIgnoringBatteryOptimizations / requestIgnoreBatteryOpt：被杀保活白名单引导
 * 全部无副作用纯判定/跳转，异常吞掉不阻塞（与 startup-check 同原则）。
 */
object FloatPermission {

    /** 是否已授予悬浮窗权限（API<23 视为已授） */
    @JvmStatic
    fun canDrawOverlays(context: Context): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            Settings.canDrawOverlays(context)
        } else {
            true
        }
    }

    /** 跳转悬浮窗授权设置页（精确到本应用的厂商页优先，失败退通用页） */
    @JvmStatic
    fun requestOverlay(activity: Activity) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return
        try {
            val intent = Intent(
                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:" + activity.packageName),
            )
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            activity.startActivity(intent)
        } catch (e: Exception) {
            try {
                val fallback = Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION)
                fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                activity.startActivity(fallback)
            } catch (e2: Exception) {
                /* 厂商 ROM 无对应设置页：吞掉，引导页显示手动开启文案 */
            }
        }
    }

    /** 是否已忽略电池优化（= 加入白名单，进程不易被杀） */
    @JvmStatic
    fun isIgnoringBatteryOptimizations(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true
        val pm = context.getSystemService(Context.POWER_SERVICE) as android.os.PowerManager
        return pm.isIgnoringBatteryOptimizations(context.packageName)
    }

    /** 请求加入电池优化白名单（Q13：用户可选；异常吞掉） */
    @JvmStatic
    fun requestIgnoreBatteryOpt(activity: Activity) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return
        try {
            val intent = Intent(
                Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                Uri.parse("package:" + activity.packageName),
            )
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            activity.startActivity(intent)
        } catch (e: Exception) {
            try {
                val fallback = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
                fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                activity.startActivity(fallback)
            } catch (e2: Exception) {
                /* 无对应设置页：吞掉，引导页显示手动开启文案 */
            }
        }
    }
}
