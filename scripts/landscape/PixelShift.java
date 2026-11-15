import vqsv.render.GameMap;
import vqsv.render.MapModInfo;
import vqsv.render.MapRenderer;
import vqsv.render.TileSet;
import vqsv.resource.AssetPaths;

import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.lang.reflect.Constructor;
import java.nio.file.Path;

/**
 * For each map id: renders the old map (modules root A) and the APK map (root B), then finds the
 * whole-tile shift that lays the old picture onto the new one with the most identical pixels.
 * Prints: id oldWxH newWxH dx dy matchShare.
 */
public class PixelShift {
    static AssetPaths paths(String root) throws Exception {
        Constructor<AssetPaths> c = AssetPaths.class.getDeclaredConstructor(Path.class);
        c.setAccessible(true);
        return c.newInstance(Path.of(root));
    }

    static BufferedImage render(AssetPaths p, int id) {
        GameMap map = GameMap.load(p, id);
        MapRenderer r = new MapRenderer(map, TileSet.load(p, MapModInfo.load(p), map.modId()));
        BufferedImage img = new BufferedImage(map.widthPixels(), map.heightPixels(), BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = img.createGraphics();
        for (int layer = 1; layer < map.layerCount(); layer++) r.renderLayerFull(g, layer);
        g.dispose();
        return img;
    }

    public static void main(String[] args) throws Exception {
        AssetPaths a = paths(args[0]), b = paths(args[1]);
        for (int i = 2; i < args.length; i++) {
            int id = Integer.parseInt(args[i]);
            try {
                BufferedImage o = render(a, id), n = render(b, id);
                int bestDx = 0, bestDy = 0;
                long best = -1, total = 0;
                int tw = n.getWidth() / 16, th = n.getHeight() / 16;
                for (int dx = -tw; dx <= tw; dx++)
                    for (int dy = -th; dy <= th; dy++) {
                        long hit = 0, all = 0;
                        for (int y = 0; y < o.getHeight(); y += 3)
                            for (int x = 0; x < o.getWidth(); x += 3) {
                                int nx = x + dx * 16, ny = y + dy * 16;
                                if (nx < 0 || ny < 0 || nx >= n.getWidth() || ny >= n.getHeight()) { all++; continue; }
                                int po = o.getRGB(x, y);
                                if ((po >>> 24) == 0) continue;
                                all++;
                                if (po == n.getRGB(nx, ny)) hit++;
                            }
                        if (hit > best) { best = hit; total = all; bestDx = dx; bestDy = dy; }
                    }
                System.out.printf("%d %dx%d %dx%d %d %d %.3f%n", id, o.getWidth() / 16, o.getHeight() / 16,
                        n.getWidth() / 16, n.getHeight() / 16, bestDx, bestDy, total == 0 ? 1.0 : (double) best / total);
            } catch (Exception ex) {
                System.out.println(id + " ERROR " + ex);
            }
        }
    }
}
