import vqsv.render.GameMap;
import vqsv.render.MapModInfo;
import vqsv.render.MapRenderer;
import vqsv.render.TileSet;
import vqsv.resource.AssetPaths;

import javax.imageio.ImageIO;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.lang.reflect.Constructor;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

/**
 * ExportWorldWebAssets.exportMap for the APK's landscape maps: every layer drawn in full from the
 * APK modules root, plus meta.json with the map's origin, the APK pixel where the old JAR map's
 * (0, 0) now lies. Usage: ExportApkMaps <apkModulesRoot> <outMapsDir> id:dx:dy ...
 */
public class ExportApkMaps {
    public static void main(String[] args) throws Exception {
        Constructor<AssetPaths> c = AssetPaths.class.getDeclaredConstructor(Path.class);
        c.setAccessible(true);
        AssetPaths paths = c.newInstance(Path.of(args[0]));
        Path out = Path.of(args[1]);
        for (int i = 2; i < args.length; i++) {
            String[] part = args[i].split(":");
            int id = Integer.parseInt(part[0]), dx = Integer.parseInt(part[1]), dy = Integer.parseInt(part[2]);
            GameMap map = GameMap.load(paths, id);
            MapRenderer renderer = new MapRenderer(map, TileSet.load(paths, MapModInfo.load(paths), map.modId()));
            Path dir = out.resolve(String.valueOf(id));
            Files.createDirectories(dir);
            for (int layer = 0; layer < map.layerCount(); layer++) {
                BufferedImage image = new BufferedImage(map.widthPixels(), map.heightPixels(), BufferedImage.TYPE_INT_ARGB);
                Graphics2D g = image.createGraphics();
                renderer.renderLayerFull(g, layer);
                g.dispose();
                ImageIO.write(image, "png", dir.resolve("layer-" + layer + ".png").toFile());
            }
            int originX = dx * map.tileWidth(), originY = dy * map.tileHeight();
            Files.writeString(dir.resolve("meta.json"),
                    "{\"width\":" + map.widthPixels() + ",\"height\":" + map.heightPixels() + ",\"layers\":" + map.layerCount()
                            + ",\"originX\":" + originX + ",\"originY\":" + originY + ",\"source\":\"apk\"}",
                    StandardCharsets.UTF_8);
            System.out.println("map_" + id + " " + map.widthTiles() + "x" + map.heightTiles() + " origin=" + originX + "," + originY);
        }
    }
}
