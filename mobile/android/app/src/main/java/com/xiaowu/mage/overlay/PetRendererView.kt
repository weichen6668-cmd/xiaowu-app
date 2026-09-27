package com.xiaowu.mage.overlay

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.net.Uri
import android.opengl.GLES20
import android.opengl.GLSurfaceView
import android.opengl.GLUtils
import android.os.SystemClock
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import javax.microedition.khronos.egl.EGLConfig
import javax.microedition.khronos.opengles.GL10
import kotlin.math.sin

/**
 * T06 悬浮 3D 小窗渲染面 —— 独立 EGLContext + GLThread（GLSurfaceView 天然自带，
 * 与主 App three 上下文完全隔离：主 App 退后台被回收不影响悬浮渲染）。
 * 渲染目标 512×512 RT（低端 256×256 由 setFps/quality 侧降）。
 * 动效：idle 摆动 + 口型（setMouth / playClip('talk') 自动振荡）——
 * 非标骨骼/无法上 VBO 的模型走 Q15「整体缩放/摆动兜底动效」，同一渲染钩子。
 * 互斥活跃：主 App 前台时仅静态贴图（paused=true 时不推进动画时间轴）。
 * T08 形态跟随：3d/2d/live2d 统一贴图四边形（原生侧 Q14 近似渲染面），
 * video 走外部帧供帧（setVideoFrame，WebM 解码在 JS/WebView 侧）。
 */
class PetRendererView(context: Context) : GLSurfaceView(context) {

    /** 形态（与 shared AvatarForm 对齐：3d/2d/live2d/video） */
    enum class Form(val wire: String) {
        FORM_3D("3d"),
        FORM_2D("2d"),
        FORM_LIVE2D("live2d"),
        FORM_VIDEO("video");

        companion object {
            fun from(wire: String): Form = when (wire) {
                "2d" -> FORM_2D
                "live2d" -> FORM_LIVE2D
                "video" -> FORM_VIDEO
                else -> FORM_3D
            }
        }
    }

    /** 形态渲染钩子（T08 扩展按 avatarSpec.form 切渲染面，此处为 GL 面） */
    interface Callback {
        /** 帧就绪（球形态取静态贴图用） */
        fun onFrame()
    }

    private val petRenderer = PetRenderer()
    var callback: Callback? = null

    init {
        // 独立 EGLContext：EGL_CONTEXT_CLIENT_VERSION 2，与主 App three 上下文互不影响
        setEGLContextClientVersion(2)
        setRenderer(petRenderer)
        // 连续渲染 + 帧内按 fps 节流（setFps 动态改帧间隔）
        renderMode = RENDERMODE_CONTINUOUSLY
    }

    /** 载入形象贴图（app 沙箱 URI；解码失败退程序化占位贴图——不阻塞悬浮） */
    fun loadModel(uri: String) {
        queueEvent {
            petRenderer.pendingTexture = decodeTexture(uri)
            petRenderer.needTextureUpload = true
        }
        requestRender()
    }

    /** T08 形态跟随：切换渲染策略（摆动幅度/口型路径按形态微调，video 走外供帧） */
    fun setForm(form: String) {
        val f = Form.from(form)
        queueEvent { petRenderer.form = f }
        requestRender()
    }

    /**
     * T08 video 形态外供帧（WebM 解码在 JS 侧，RGBA 位图推 GL 面）。
     * @param bmp RGBA 帧（上传后由 GL 线程 recycle，调用方勿复用同一 Bitmap）
     */
    fun setVideoFrame(bmp: Bitmap) {
        queueEvent {
            petRenderer.pendingTexture = bmp
            petRenderer.needTextureUpload = true
            petRenderer.form = Form.FORM_VIDEO
        }
        requestRender()
    }

    /** 播放动作/口型 clip：idle / talk / wave / nod（clipMap 名经 JS 桥映射后传入） */
    fun playClip(name: String) {
        queueEvent { petRenderer.playClip(name) }
        requestRender()
    }

    /** 目标帧率：high=30 / mid=24 / low=8（省电） */
    fun setFps(n: Int) {
        petRenderer.frameIntervalMs = (1000f / n.coerceIn(1, 60)).toLong()
    }

    /** 口型开合 0..1（TTS 20Hz 推送链路） */
    fun setMouth(open: Float) {
        queueEvent { petRenderer.mouthOpenTarget = open.coerceIn(0f, 1f) }
        requestRender()
    }

    /** 静态贴图推送（base64 PNG/JPEG；WebView 3D 帧快照 → GL 面，Q14 近似渲染） */
    fun setTextureB64(b64: String) {
        val raw = b64.substringAfter("base64,", b64)
        val bytes = try {
            android.util.Base64.decode(raw, android.util.Base64.DEFAULT)
        } catch (e: Exception) {
            return
        }
        val bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return
        queueEvent {
            petRenderer.pendingTexture = bmp
            petRenderer.needTextureUpload = true
        }
        requestRender()
    }

    /** 球形态圆形裁剪（uRound=1 丢弃四角像素，与桌宠矩形面视觉区分） */
    fun setBallMask(on: Boolean) {
        queueEvent { petRenderer.ballMask = on }
        requestRender()
    }

    /** 主 App 前台/后台互斥活跃：暂停推进动画时间轴（GLSurfaceView.onPause 停 GL 线程） */
    fun pauseAnim() {
        queueEvent { petRenderer.animPaused = true }
    }

    fun resumeAnim() {
        queueEvent { petRenderer.animPaused = false }
        requestRender()
    }

    /** 解码贴图：content/file URI → Bitmap；失败生成程序化占位（Q15 兜底） */
    private fun decodeTexture(uri: String): Bitmap {
        return try {
            val u = Uri.parse(uri)
            val stream = context.contentResolver.openInputStream(u)
            val bmp = BitmapFactory.decodeStream(stream)
            stream?.close()
            bmp ?: placeholderBitmap()
        } catch (e: Exception) {
            try {
                val bmp = BitmapFactory.decodeFile(uri)
                bmp ?: placeholderBitmap()
            } catch (e2: Exception) {
                placeholderBitmap()
            }
        }
    }

    /** 程序化占位贴图：512² 渐变 + 圆形脸（模型缺失/解码失败仍可拖拽交互） */
    private fun placeholderBitmap(): Bitmap {
        val bmp = Bitmap.createBitmap(512, 512, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        val p = Paint(Paint.ANTI_ALIAS_FLAG)
        p.color = Color.rgb(88, 64, 160)
        c.drawRect(0f, 0f, 512f, 512f, p)
        p.color = Color.rgb(180, 160, 240)
        c.drawCircle(256f, 220f, 140f, p)
        p.color = Color.rgb(60, 40, 120)
        c.drawCircle(210f, 200f, 18f, p)
        c.drawCircle(302f, 200f, 18f, p)
        return bmp
    }

    /** 内部渲染器：贴图四边形 + idle 摆动 + 口型振荡（512² 视口） */
    private inner class PetRenderer : Renderer {
        @Volatile var pendingTexture: Bitmap? = null
        @Volatile var needTextureUpload = false
        @Volatile var frameIntervalMs = 33L // 默认 30fps
        @Volatile var animPaused = false
        @Volatile var mouthOpenTarget = 0f
        @Volatile var form: Form = Form.FORM_3D
        @Volatile var ballMask = false

        private var texId = 0
        private var program = 0
        private var aPos = 0
        private var aUv = 0
        private var uMvp = 0
        private var uMouth = 0
        private var uRound = 0
        private var vbo: FloatBuffer? = null
        private var startMs = SystemClock.elapsedRealtime()
        private var lastFrameMs = 0L
        private var animTime = 0f
        private var mouthOpen = 0f
        private var clipName = "idle"

        // x,y,u,v × 4（三角带）：含口型下半区顶点（uv.y 高位=嘴部区，shader 内按 uMouth 下移）
        private val quad = floatArrayOf(
            -0.7f, 0.9f, 0f, 0f,
            0.7f, 0.9f, 1f, 0f,
            -0.7f, -0.9f, 0f, 1f,
            0.7f, -0.9f, 1f, 1f,
        )

        fun playClip(name: String) {
            clipName = if (name.isBlank()) "idle" else name
            if (clipName == "talk") mouthOpenTarget = 0.6f
        }

        override fun onSurfaceCreated(gl: GL10?, config: EGLConfig?) {
            GLES20.glClearColor(0f, 0f, 0f, 0f) // 透明底（悬浮叠桌面）
            program = buildProgram()
            aPos = GLES20.glGetAttribLocation(program, "aPos")
            aUv = GLES20.glGetAttribLocation(program, "aUv")
            uMvp = GLES20.glGetUniformLocation(program, "uMvp")
            uMouth = GLES20.glGetUniformLocation(program, "uMouth")
            uRound = GLES20.glGetUniformLocation(program, "uRound")
            vbo = ByteBuffer.allocateDirect(quad.size * 4)
                .order(ByteOrder.nativeOrder())
                .asFloatBuffer()
                .put(quad)
            vbo?.position(0)
            texId = genTexture()
        }

        override fun onSurfaceChanged(gl: GL10?, width: Int, height: Int) {
            GLES20.glViewport(0, 0, width, height)
        }

        override fun onDrawFrame(gl: GL10?) {
            val now = SystemClock.elapsedRealtime()
            // fps 节流：间隔内跳过绘制（GLSurfaceView 连续渲染，这里自节流保电量）
            if (now - lastFrameMs < frameIntervalMs) {
                GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)
                return
            }
            lastFrameMs = now
            if (!animPaused) animTime = (now - startMs) / 1000f

            // 贴图上传（GL 线程内执行，线程安全）
            if (needTextureUpload) {
                pendingTexture?.let {
                    GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, texId)
                    GLUtils.texImage2D(GLES20.GL_TEXTURE_2D, 0, it, 0)
                    if (!it.isRecycled) it.recycle()
                }
                pendingTexture = null
                needTextureUpload = false
            }

            // 口型趋近（talk clip 自动振荡，其余向目标趋近；video 形态自带口型画面不叠加）
            val target = if (form != Form.FORM_VIDEO && clipName == "talk" && !animPaused) {
                (0.5f + 0.5f * sin(animTime * 14f)).coerceIn(0f, 1f)
            } else if (form == Form.FORM_VIDEO) {
                0f
            } else {
                mouthOpenTarget
            }
            mouthOpen += (target - mouthOpen) * 0.35f

            // Q15 兜底摆动：整体轻微左右摆 + 呼吸缩放（非标骨骼/占位贴图同链路）。
            // video 形态仅极轻呼吸（画面自带动效避免叠加晕眩）；2d 立绘摆动减半。
            val swayScale = when (form) {
                Form.FORM_VIDEO -> 0f
                Form.FORM_2D -> 0.5f
                else -> 1f
            }
            val sway = sin(animTime * 1.6f) * 0.04f * swayScale
            val breatheAmp = if (form == Form.FORM_VIDEO) 0.004f else 0.015f
            val breathe = 1f + sin(animTime * 2.2f) * breatheAmp
            val mvp = floatArrayOf(
                breathe, 0f, 0f, 0f,
                0f, breathe, 0f, 0f,
                0f, 0f, 1f, 0f,
                sway, 0f, 0f, 1f,
            )

            GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)
            GLES20.glUseProgram(program)
            GLES20.glEnable(GLES20.GL_BLEND)
            GLES20.glBlendFunc(GLES20.GL_SRC_ALPHA, GLES20.GL_ONE_MINUS_SRC_ALPHA)
            GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
            GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, texId)
            GLES20.glUniformMatrix4fv(uMvp, 1, false, mvp, 0)
            GLES20.glUniform1f(uMouth, mouthOpen)
            GLES20.glUniform1f(uRound, if (ballMask) 1f else 0f)
            vbo?.position(0)
            GLES20.glVertexAttribPointer(aPos, 2, GLES20.GL_FLOAT, false, 16, vbo)
            vbo?.position(2)
            GLES20.glVertexAttribPointer(aUv, 2, GLES20.GL_FLOAT, false, 16, vbo)
            GLES20.glEnableVertexAttribArray(aPos)
            GLES20.glEnableVertexAttribArray(aUv)
            GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
            callback?.onFrame()
        }

        private fun genTexture(): Int {
            val ids = IntArray(1)
            GLES20.glGenTextures(1, ids, 0)
            GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, ids[0])
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)
            return ids[0]
        }

        private fun buildProgram(): Int {
            val vs = (
                "attribute vec2 aPos;\n" +
                    "attribute vec2 aUv;\n" +
                    "uniform mat4 uMvp;\n" +
                    "varying vec2 vUv;\n" +
                    "void main(){ vUv = aUv; gl_Position = uMvp * vec4(aPos, 0.0, 1.0); }"
                )
            val fs = (
                "precision mediump float;\n" +
                    "varying vec2 vUv;\n" +
                    "uniform sampler2D uTex;\n" +
                    "uniform float uMouth;\n" +
                    "uniform float uRound;\n" +
                    "void main(){\n" +
                    "  vec2 uv = vUv;\n" +
                    // 口型：嘴部区（uv.y>0.62）随 uMouth 下压下半脸像素，形成开合感
                    "  if (uv.y > 0.62) { uv.y += uMouth * 0.10 * smoothstep(0.62, 1.0, uv.y); }\n" +
                    "  vec4 c = texture2D(uTex, uv);\n" +
                    // 球形态：圆形裁剪 + 边缘羽化（桌宠矩形面零改动）
                    "  if (uRound > 0.5) {\n" +
                    "    float d = distance(vUv, vec2(0.5, 0.5));\n" +
                    "    float a = 1.0 - smoothstep(0.47, 0.5, d);\n" +
                    "    c.a *= a;\n" +
                    "  }\n" +
                    "  gl_FragColor = c;\n" +
                    "}"
                )
            val vId = compile(GLES20.GL_VERTEX_SHADER, vs)
            val fId = compile(GLES20.GL_FRAGMENT_SHADER, fs)
            val p = GLES20.glCreateProgram()
            GLES20.glAttachShader(p, vId)
            GLES20.glAttachShader(p, fId)
            GLES20.glLinkProgram(p)
            return p
        }

        private fun compile(type: Int, src: String): Int {
            val id = GLES20.glCreateShader(type)
            GLES20.glShaderSource(id, src)
            GLES20.glCompileShader(id)
            return id
        }
    }
}
