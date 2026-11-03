/* Minimaler ZIP-Leser: holt eine einzelne Datei aus einem (auch großen) ZIP,
   ohne das ganze Archiv in den Speicher zu laden. Unterstützt ZIP64.
   Nutzt DecompressionStream (Chrome 80+, Safari 16.4+, Firefox 113+). */
(function (root) {
  const MAX32 = 0xffffffff;
  async function readBytes(file, start, len) {
    return new Uint8Array(await file.slice(start, start + len).arrayBuffer());
  }
  const u16 = (b, o) => b[o] | (b[o + 1] << 8);
  const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
  const u64 = (b, o) => u32(b, o) + u32(b, o + 4) * 0x100000000;

  function zipError(code, msg, arg) { const e = new Error(msg + ' Entpacke die ZIP und wähle die data.json direkt.'); e.zip = true; e.code = code; e.arg = arg; return e; }

  async function findCentralDirectory(file) {
    const tailLen = Math.min(file.size, 65557);
    const tailStart = file.size - tailLen;
    const tail = await readBytes(file, tailStart, tailLen);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) if (u32(tail, i) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw zipError('notzip', 'Die Datei ist keine gültige ZIP-Datei.');
    let count = u16(tail, eocd + 10), cdSize = u32(tail, eocd + 12), cdOff = u32(tail, eocd + 16);
    // ZIP64: Locator steht direkt vor dem EOCD
    if ((count === 0xffff || cdSize === MAX32 || cdOff === MAX32) && eocd >= 20 && u32(tail, eocd - 20) === 0x07064b50) {
      const eocd64Off = u64(tail, eocd - 20 + 8);
      const e64 = await readBytes(file, eocd64Off, 56);
      if (u32(e64, 0) !== 0x06064b50) throw zipError('zip64bad', 'Das ZIP64-Verzeichnis der Datei ist beschädigt.');
      count = u64(e64, 32); cdSize = u64(e64, 40); cdOff = u64(e64, 48);
    }
    return { count, cdSize, cdOff };
  }

  function zip64Extra(cd, start, len, vals) {
    // vals: { usize, csize, lho } – nur die Felder mit 0xFFFFFFFF stehen im Extra-Feld, in dieser Reihenfolge
    let p = start;
    while (p + 4 <= start + len) {
      const id = u16(cd, p), size = u16(cd, p + 2);
      if (id === 0x0001) {
        let q = p + 4;
        if (vals.usize === MAX32) { vals.usize = u64(cd, q); q += 8; }
        if (vals.csize === MAX32) { vals.csize = u64(cd, q); q += 8; }
        if (vals.lho === MAX32) { vals.lho = u64(cd, q); q += 8; }
        break;
      }
      p += 4 + size;
    }
    return vals;
  }

  async function inflateToText(blob) {
    const reader = blob.stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
    const dec = new TextDecoder('utf-8');
    let out = '', got = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        got += value.length; out += dec.decode(value, { stream: true });
      }
    } catch (e) {
      // Manche Packer hängen Daten an den komprimierten Strom an. Was bis dahin entpackt wurde, ist vollständig.
      if (!got) throw zipError('inflate', 'Die ZIP-Datei konnte nicht entpackt werden (' + (e && e.message || e) + ').', String(e && e.message || e));
    }
    return out + dec.decode();
  }

  async function readZipEntry(file, match) {
    const { count, cdSize, cdOff } = await findCentralDirectory(file);
    const cd = await readBytes(file, cdOff, cdSize);
    let p = 0, entry = null;
    for (let n = 0; n < count && p + 46 <= cd.length; n++) {
      if (u32(cd, p) !== 0x02014b50) break;
      const flags = u16(cd, p + 8), method = u16(cd, p + 10);
      const nameLen = u16(cd, p + 28), extraLen = u16(cd, p + 30), comLen = u16(cd, p + 32);
      const nameBytes = cd.subarray(p + 46, p + 46 + nameLen);
      const name = new TextDecoder(flags & 0x800 ? 'utf-8' : 'utf-8').decode(nameBytes);
      if (match.test(name)) {
        const v = zip64Extra(cd, p + 46 + nameLen, extraLen, { usize: u32(cd, p + 24), csize: u32(cd, p + 20), lho: u32(cd, p + 42) });
        entry = { name, flags, method, csize: v.csize, lho: v.lho };
        break;
      }
      p += 46 + nameLen + extraLen + comLen;
    }
    if (!entry) return null;
    if (entry.flags & 0x1) throw zipError('encrypted', 'Die ZIP-Datei ist verschlüsselt.');
    const lh = await readBytes(file, entry.lho, 30);
    if (u32(lh, 0) !== 0x04034b50) throw zipError('broken', 'Die ZIP-Datei ist beschädigt.');
    const dataStart = entry.lho + 30 + u16(lh, 26) + u16(lh, 28);
    const blob = file.slice(dataStart, dataStart + entry.csize);
    if (entry.method === 0) return await blob.text();
    if (entry.method !== 8) throw zipError('method', 'Die ZIP-Datei nutzt ein Kompressionsverfahren, das der Browser nicht kennt (Methode ' + entry.method + ').', entry.method);
    if (typeof DecompressionStream === 'undefined') throw zipError('nodecomp', 'Dieser Browser kann ZIP-Dateien nicht entpacken.');
    return await inflateToText(blob);
  }

  root.readZipEntry = readZipEntry;
})(typeof window !== 'undefined' ? window : globalThis);
