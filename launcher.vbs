Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "C:\Users\ASUS\Desktop\Ungdungcuatoi\google-maps-scraper"
WshShell.Run "cmd /c npx electron .", 0, True
