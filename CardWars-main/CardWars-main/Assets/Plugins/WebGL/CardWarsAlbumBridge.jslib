mergeInto(LibraryManager.library, {
  CardWarsAlbumSession: function () {
    var value = "";
    try {
      value = window.sessionStorage.getItem("cardwars_api_session") || "";
    } catch (error) {
      value = "";
    }

    var size = lengthBytesUTF8(value) + 1;
    var buffer = _malloc(size);
    stringToUTF8(value, buffer, size);
    return buffer;
  }
});
