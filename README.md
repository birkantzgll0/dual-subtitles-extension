# Dual Subtitle Master

Chrome için Manifest V3 eklentisi. İngilizce ve Türkçe HTML5 altyazı parçalarını tek bir sürüklenebilir kutuda gösterir. İşleme tarayıcıda gerçekleşir. Eklenti bir çeviri servisi kullanmaz ve dışarıya veri göndermez. Tarayıcı, oynatıcının tanımladığı altyazı dosyalarını kendi normal medya yükleme süreciyle isteyebilir.

## Kurulum

1. Chrome'da `chrome://extensions` sayfasını aç.
2. **Geliştirici modu** seçeneğini etkinleştir.
3. **Paketlenmemiş öğe yükle** düğmesiyle `manifest.json` dosyasının bulunduğu klasörü seç.
4. Açık video sekmesini yenile. Altyazı kutusu göründüğünde sürükleyerek konumlandır.

## Altyazı kaynakları

- HTML5 `TextTrack` üzerinden erişilebilen İngilizce ve Türkçe parçalar, kendi zaman damgalarına göre aynı kutuda gösterilir. Yalnızca bir dil mevcutsa tek satır görünür.
- YouTube, Netflix ve Disney+ için ekranda oluşturulan altyazı öğeleri de izlenir. Bu yol, sitenin DOM'a yazdığı metinle sınırlıdır. Site yalnızca seçili dili yayımlıyorsa ikinci satır için erişilebilir ikinci bir parça gerekir. Bu seçiciler oynatıcı güncellemelerinden etkilenebilir.
- Kutunun sınırları video dikdörtgeniyle görünür pencere alanının kesişimine göre hesaplanır. Tam ekran kapsayıcı içinde çalışabilir. Doğrudan video öğesinin tam ekranı ve tarayıcının yerleşik Resim İçinde Resim penceresi bu kutuyu gösteremez.

## Ayarlar

Konum, Chrome'un yerel eklenti depolamasına otomatik kaydedilir. İleride bir ayarlar arayüzü, aynı depolamadaki `languages` (iki farklı dil kodu), `size` (12–48 piksel), `firstColor` ve `secondColor` (altı haneli hex renk) alanlarını kullanabilir.

## Lisans

MIT © Birkan Tazegül (@birkantzgll0).
