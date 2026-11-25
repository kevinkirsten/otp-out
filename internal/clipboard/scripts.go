package clipboard

import (
	"encoding/base64"
	"unicode/utf16"
)

const osascriptPath = "/usr/bin/osascript"

// macScript copies stdin to a pasteboard (the general one when argv[1] is
// empty) as plain text plus the nspasteboard.org markers that ask clipboard
// history managers not to store or show it. "Current host only" keeps it
// off Universal Clipboard. argv[0] is "copy" or "clear".
const macScript = `
ObjC.import('AppKit');
ObjC.import('Foundation');
function run(argv) {
  var name = argv.length > 1 ? argv[1] : '';
  var pb = name ? $.NSPasteboard.pasteboardWithName(name) : $.NSPasteboard.generalPasteboard;
  if (argv[0] === 'clear') {
    pb.clearContents;
    return '';
  }
  var data = $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile;
  var text = $.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding);
  pb.prepareForNewContentsWithOptions(1);
  var ok = pb.setStringForType(text, $.NSPasteboardTypeString);
  pb.setStringForType($(''), 'org.nspasteboard.ConcealedType');
  pb.setStringForType($(''), 'org.nspasteboard.TransientType');
  if (!ok) { throw new Error('write failed'); }
  return '';
}
`

// macOSMethod uses osascript. pasteboard is empty for the general
// clipboard; tests pass a private pasteboard name.
func macOSMethod(pasteboard string) method {
	return method{
		path:       osascriptPath,
		copyArgs:   []string{"-l", "JavaScript", "-e", macScript, "copy", pasteboard},
		clearArgs:  []string{"-l", "JavaScript", "-e", macScript, "clear", pasteboard},
		concealed:  true,
		encode:     plain,
		clearInput: empty,
	}
}

// windowsCopyScript reads base64 text from stdin (so no console code page
// can garble it) and puts it on the clipboard with the formats that exclude
// it from clipboard monitors, Windows clipboard history and cloud sync.
const windowsCopyScript = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$b64 = [Console]::In.ReadToEnd().Trim()
$text = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($b64))
$d = New-Object System.Windows.Forms.DataObject
$d.SetData([System.Windows.Forms.DataFormats]::UnicodeText, $text)
$zero = [byte[]](0,0,0,0)
$d.SetData('ExcludeClipboardContentFromMonitorProcessing', (New-Object System.IO.MemoryStream(,$zero)))
$d.SetData('CanIncludeInClipboardHistory', (New-Object System.IO.MemoryStream(,$zero)))
$d.SetData('CanUploadToCloudClipboard', (New-Object System.IO.MemoryStream(,$zero)))
[System.Windows.Forms.Clipboard]::SetDataObject($d, $true, 5, 100)
`

const windowsClearScript = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Clipboard]::Clear()
`

func windowsMethod(powershell string) method {
	flags := []string{"-NoProfile", "-NonInteractive", "-STA", "-EncodedCommand"}
	return method{
		path:      powershell,
		copyArgs:  append(append([]string(nil), flags...), encodePowerShell(windowsCopyScript)),
		clearArgs: append(append([]string(nil), flags...), encodePowerShell(windowsClearScript)),
		concealed: true,
		encode: func(s string) []byte {
			return []byte(base64.StdEncoding.EncodeToString([]byte(s)))
		},
		clearInput: empty,
	}
}

// encodePowerShell returns the base64 of the UTF-16LE script, the format
// of powershell.exe -EncodedCommand.
func encodePowerShell(script string) string {
	u := utf16.Encode([]rune(script))
	b := make([]byte, 0, len(u)*2)
	for _, c := range u {
		b = append(b, byte(c), byte(c>>8))
	}
	return base64.StdEncoding.EncodeToString(b)
}
