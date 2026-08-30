using Selatza.Learn.Nn;

namespace Selatza.Learn;

/// <summary>
/// The whole run in one file, written after every round.
///
/// A training run is hours of work that a crash, a reboot or an update would
/// otherwise throw away, and a stack overflow inside a card effect cannot be
/// caught from inside the process, so the only real protection is a recent file
/// on disk. Writes go to a temporary name and are moved into place, and the
/// file being replaced is kept as .prev, so a crash during the write itself
/// still leaves one good snapshot behind.
///
/// The replay buffer is deliberately not saved: it is hundreds of megabytes and
/// refills within a few rounds of play.
/// </summary>
public static class Snapshot
{
    public const int Magic = 0x314B4E53; // "SNK1"
    public const int Version = 2;
    public const string FileName = "snapshot.bin";

    public static string PathIn(string dir) => Path.Combine(dir, FileName);

    public static bool Exists(string dir) => File.Exists(PathIn(dir));

    public static void Write(string dir, Action<BinaryWriter> body)
    {
        Directory.CreateDirectory(dir);
        string final = PathIn(dir);
        string tmp = final + ".tmp";
        string prev = final + ".prev";

        using (var fs = File.Create(tmp))
        using (var w = new BinaryWriter(fs))
        {
            w.Write(Magic);
            w.Write(Version);
            body(w);
            w.Flush();
            fs.Flush(flushToDisk: true);
        }

        if (File.Exists(final)) File.Move(final, prev, overwrite: true);
        File.Move(tmp, final, overwrite: true);
    }

    /// <summary>Opens the snapshot, falling back to the previous one if the newest is unreadable.</summary>
    public static bool Read(string dir, Func<BinaryReader, bool> body)
    {
        foreach (var path in new[] { PathIn(dir), PathIn(dir) + ".prev" })
        {
            if (!File.Exists(path)) continue;
            try
            {
                using var fs = File.OpenRead(path);
                using var r = new BinaryReader(fs);
                if (r.ReadInt32() != Magic) continue;
                if (r.ReadInt32() != Version) continue;
                if (body(r)) return true;
            }
            catch (Exception ex) when (ex is EndOfStreamException or InvalidDataException or IOException)
            {
                Console.Error.WriteLine($"  {Path.GetFileName(path)} is unreadable ({ex.Message}), trying the older one");
            }
        }
        return false;
    }

    public static void SaveParams(BinaryWriter w, SelatzaNet net, bool moments)
    {
        w.Write(net.Parameters.Count);
        foreach (var p in net.Parameters)
        {
            w.Write(p.W.Length);
            foreach (var v in p.W) w.Write(v);
            if (!moments) continue;
            foreach (var v in p.M) w.Write(v);
            foreach (var v in p.V) w.Write(v);
        }
    }

    public static void LoadParams(BinaryReader r, SelatzaNet net, bool moments)
    {
        int count = r.ReadInt32();
        if (count != net.Parameters.Count)
        {
            throw new InvalidDataException($"snapshot holds {count} tensors, this build wants {net.Parameters.Count}");
        }
        foreach (var p in net.Parameters)
        {
            int len = r.ReadInt32();
            if (len != p.W.Length)
            {
                throw new InvalidDataException($"snapshot tensor {p.Name} is {len}, this build wants {p.W.Length}");
            }
            for (int i = 0; i < len; i++) p.W[i] = r.ReadSingle();
            if (!moments) continue;
            for (int i = 0; i < len; i++) p.M[i] = r.ReadSingle();
            for (int i = 0; i < len; i++) p.V[i] = r.ReadSingle();
        }
        net.AfterStep();
    }
}
