import io

import matplotlib.image as mpimg
from status_bot.chart import render_chart
from status_bot.report import build_report

PNG = b"\x89PNG"


def size(png):
    img = mpimg.imread(io.BytesIO(png))
    return img.shape[1], img.shape[0]


def test_chart_from_real_fixtures(real):
    r = build_report(real["queue"], real["cloud"], real["jobs"], real["alerts"], real["cost30"])
    png = render_chart(r)
    assert png.startswith(PNG)
    assert size(png) == (900, 700)


def test_chart_with_empty_data():
    png = render_chart(build_report(None, None, None, None))
    assert png.startswith(PNG)
    assert size(png) == (900, 700)
