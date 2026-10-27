using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Windows.Forms;

internal static class PortableLauncher
{
    // Quote arguments for Windows CreateProcess without invoking a shell.
    private static string Quote(string value)
    {
        var text = new StringBuilder("\"");
        int slashes = 0;
        foreach (char c in value)
        {
            if (c == '\\') { slashes++; continue; }
            if (c == '"') text.Append('\\', slashes * 2 + 1);
            else text.Append('\\', slashes);
            text.Append(c);
            slashes = 0;
        }
        text.Append('\\', slashes * 2);
        return text.Append('"').ToString();
    }

    [STAThread]
    private static int Main(string[] args)
    {
        try
        {
            string directory = AppDomain.CurrentDomain.BaseDirectory;
            string runtime = Path.Combine(directory, "App", "Dockyard.exe");
            string data = Path.Combine(directory, "Data");
            if (!File.Exists(runtime))
                throw new FileNotFoundException("Please extract the entire ZIP before starting Dockyard. / 请先完整解压绿色包。");
            var arguments = new List<string>();
            foreach (string argument in args)
            {
                if (argument == "--data-dir" || argument.StartsWith("--data-dir="))
                    throw new ArgumentException("Portable data is stored in the Data folder. / 绿色版数据固定保存在 Data 文件夹。");
                arguments.Add(Quote(argument));
            }
            arguments.Add("--data-dir");
            arguments.Add(Quote(data));
            Directory.CreateDirectory(data);
            var info = new ProcessStartInfo(runtime, String.Join(" ", arguments.ToArray()));
            info.WorkingDirectory = directory;
            info.UseShellExecute = false;
            info.CreateNoWindow = true;
            info.RedirectStandardOutput = true;
            info.RedirectStandardError = true;
            info.StandardOutputEncoding = Encoding.UTF8;
            info.StandardErrorEncoding = Encoding.UTF8;
            info.EnvironmentVariables.Remove("ELECTRON_RUN_AS_NODE");
            using (var child = new Process())
            {
                child.StartInfo = info;
                child.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e) { if (e.Data != null) Console.Out.WriteLine(e.Data); };
                child.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e) { if (e.Data != null) Console.Error.WriteLine(e.Data); };
                child.Start();
                child.BeginOutputReadLine();
                child.BeginErrorReadLine();
                child.WaitForExit();
                return child.ExitCode;
            }
        }
        catch (Exception error)
        {
            MessageBox.Show(error.Message, "Dockyard Portable / 绿色版", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }
}
