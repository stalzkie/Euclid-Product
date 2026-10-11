import { describe, expect, it } from "vitest";
import { clusterPosts, type ClusterInput } from "@/lib/ai/clustering";
import { CLUSTER_MEMBER } from "@/lib/ai/thresholds";

/**
 * Clustering decides what the Themes screen says users want. The failure that
 * matters is not "no clusters" — it is clusters that quietly merge unrelated
 * requests, because a founder reads those as fact and builds from them.
 *
 * Vectors here are hand-built in a small space with known angles, so each
 * expectation comes from geometry rather than from re-running the algorithm.
 */

/** A unit vector pointing mostly along `axis`, with `noise` spread elsewhere. */
function vec(axis: number, noise = 0, dims = 8): number[] {
  const v = new Array(dims).fill(0);
  v[axis] = 1;
  for (let i = 0; i < dims; i++) if (i !== axis) v[i] = noise;
  const length = Math.hypot(...v);
  return v.map((x) => x / length);
}

function post(id: string, embedding: number[], votes = 10): ClusterInput {
  return { id, title: `Post ${id}`, body: null, votes, embedding };
}

describe("clusterPosts", () => {
  it("groups posts that point the same way", () => {
    const clusters = clusterPosts([
      post("a", vec(0)),
      post("b", vec(0, 0.05)),
      post("c", vec(0, 0.08)),
    ]);

    expect(clusters).toHaveLength(1);
    expect(clusters[0].postIds.sort()).toEqual(["a", "b", "c"]);
  });

  it("keeps unrelated posts apart", () => {
    const clusters = clusterPosts([post("a", vec(0)), post("b", vec(1)), post("c", vec(2))]);

    expect(clusters).toHaveLength(3);
    expect(clusters.every((c) => c.postIds.length === 1)).toBe(true);
  });

  it("does not let a chain of posts drift into swallowing an outsider", () => {
    // This is the bug that shipped: three posts forming a chain (each close
    // to the next, the ends far apart) average out to a midpoint, and that
    // midpoint sits close enough to an unrelated post to absorb it. On the
    // real board it put "Offline mode on iOS" inside data export.
    //
    // Angles make the geometry checkable by hand:
    //   members at 0°, 30°, 60°  ->  their mean points at 30°
    //   outsider at 95°
    //   cos(mean, outsider)        = cos(65°) = 0.42   <- a centroid merges
    //   mean of cos to each member = 0.39               <- linkage does not
    const at = (deg: number) => {
      const r = (deg * Math.PI) / 180;
      return [Math.cos(r), Math.sin(r)];
    };
    const posts = [
      post("a", at(0), 30),
      post("b", at(30), 20),
      post("c", at(60), 10),
      post("outsider", at(95), 5),
    ];

    // A threshold between the two numbers above: drift merges, linkage keeps
    // the outsider out.
    const clusters = clusterPosts(posts, 0.4);
    const home = clusters.find((c) => c.postIds.includes("outsider"));

    expect(home?.postIds).toEqual(["outsider"]);
  });

  it("orders clusters by combined votes, so the biggest theme leads", () => {
    const clusters = clusterPosts([
      post("small", vec(1), 5),
      post("big-a", vec(0), 100),
      post("big-b", vec(0, 0.05), 80),
    ]);

    expect(clusters[0].votes).toBe(180);
    expect(clusters[0].postIds).toContain("big-a");
  });

  it("anchors each cluster on its most-voted post", () => {
    // Titles are fed to the namer in order, so the leading one should be the
    // request with the most support, not whichever arrived first.
    const clusters = clusterPosts([
      post("quiet", vec(0, 0.05), 3),
      post("loud", vec(0), 200),
    ]);

    expect(clusters[0].titles[0]).toBe("Post loud");
  });

  it("sums the votes of its members", () => {
    const clusters = clusterPosts([
      post("a", vec(0), 40),
      post("b", vec(0, 0.05), 25),
    ]);

    expect(clusters[0].votes).toBe(65);
  });

  it("computes a centroid that sits among its members", () => {
    const clusters = clusterPosts([post("a", vec(0)), post("b", vec(0, 0.05))]);
    const { centroid } = clusters[0];

    expect(centroid).toHaveLength(8);
    // The shared axis dominates, as it must for an average of two vectors
    // that both point that way.
    expect(Math.max(...centroid)).toBe(centroid[0]);
  });

  it("returns an empty list for no posts", () => {
    expect(clusterPosts([])).toEqual([]);
  });

  it("handles a single post without inventing a theme", () => {
    const clusters = clusterPosts([post("only", vec(0))]);

    expect(clusters).toHaveLength(1);
    expect(clusters[0].postIds).toEqual(["only"]);
  });

  it("splits more finely as the threshold rises", () => {
    const posts = [post("a", vec(0)), post("b", vec(0, 0.3)), post("c", vec(0, 0.5))];

    const loose = clusterPosts(posts, 0.2);
    const strict = clusterPosts(posts, 0.99);

    expect(loose.length).toBeLessThan(strict.length);
    expect(strict).toHaveLength(3);
  });
});

describe("CLUSTER_MEMBER threshold", () => {
  it("sits between unrelated and duplicate similarity", () => {
    // Measured on a real board: unrelated pairs land near 0.1–0.25, genuine
    // duplicates near 0.40–0.68. A theme is looser than a duplicate but must
    // stay well clear of noise.
    expect(CLUSTER_MEMBER).toBeGreaterThan(0.25);
    expect(CLUSTER_MEMBER).toBeLessThan(0.68);
  });
});
