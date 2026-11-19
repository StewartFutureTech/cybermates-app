package com.cybermates.app;

import android.os.Build;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/** Lightweight emulator heuristics. Returns {isEmulator, reasons}. Not anti-tamper. */
@CapacitorPlugin(name = "EmulatorCheck")
public class EmulatorCheckPlugin extends Plugin {

    @PluginMethod
    public void check(PluginCall call) {
        List<String> reasons = detect();
        JSObject ret = new JSObject();
        ret.put("isEmulator", !reasons.isEmpty());
        JSArray arr = new JSArray();
        for (String r : reasons) arr.put(r);
        ret.put("reasons", arr);
        call.resolve(ret);
    }

    private static String prop(String key) {
        try {
            Class<?> sp = Class.forName("android.os.SystemProperties");
            Object v = sp.getMethod("get", String.class).invoke(null, key);
            return v == null ? "" : v.toString();
        } catch (Throwable t) { return ""; }
    }

    private static String lc(String s) { return s == null ? "" : s.toLowerCase(Locale.US); }

    static List<String> detect() {
        List<String> r = new ArrayList<>();
        if ("1".equals(prop("ro.kernel.qemu"))) r.add("ro.kernel.qemu=1");
        String hw = lc(prop("ro.hardware"));
        if (hw.contains("goldfish") || hw.contains("ranchu") || hw.contains("vbox86")) r.add("ro.hardware=" + hw);

        String fp = lc(Build.FINGERPRINT), model = Build.MODEL == null ? "" : Build.MODEL, manu = lc(Build.MANUFACTURER),
               brand = lc(Build.BRAND), device = lc(Build.DEVICE), product = lc(Build.PRODUCT), hardware = lc(Build.HARDWARE),
               board = lc(Build.BOARD), bootloader = lc(Build.BOOTLOADER);
        if (fp.startsWith("generic") || fp.startsWith("unknown") || fp.contains("emulator")) r.add("Build.FINGERPRINT=" + Build.FINGERPRINT);
        if (model.contains("google_sdk") || model.contains("Emulator") || model.contains("Android SDK built for x86")) r.add("Build.MODEL=" + model);
        if (manu.contains("genymotion")) r.add("Build.MANUFACTURER=" + Build.MANUFACTURER);
        if (brand.startsWith("generic") && device.startsWith("generic")) r.add("Build.BRAND/DEVICE generic");
        if (product.equals("sdk") || product.equals("google_sdk") || product.equals("sdk_x86") || product.equals("vbox86p") || product.startsWith("sdk_gphone"))
            r.add("Build.PRODUCT=" + Build.PRODUCT);
        if (hardware.contains("goldfish") || hardware.contains("ranchu")) r.add("Build.HARDWARE=" + Build.HARDWARE);

        // BlueStacks / Nox / LDPlayer tells
        String all = fp + " " + lc(model) + " " + manu + " " + brand + " " + device + " " + product + " " + hardware + " " + board + " " + bootloader;
        if (all.contains("bluestacks") || new File("/data/bluestacks.prop").exists() || new File("/system/bin/bstk").exists()) r.add("BlueStacks");
        if (all.contains("nox") || new File("/system/bin/nox-prop").exists() || new File("/system/lib/libnoxspeedup.so").exists()) r.add("Nox");
        if (all.contains("ldplayer") || all.contains("ldmnq") || new File("/system/bin/ldinit").exists() || new File("/system/lib/libldutils.so").exists()) r.add("LDPlayer");
        return r;
    }
}
